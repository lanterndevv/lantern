import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChatMsg, Id, S2C } from '@lantern/protocol';
import { PROTOCOL_VERSION } from '@lantern/protocol';
import { roll } from '@lantern/rules';
import { openDb } from './db.ts';
import { createAccounts } from './accounts.ts';
import { MAX_SCENES } from './validate.ts';
import { MAX_ASSET, exportCampaign, importCampaign, parseUvtt, sha256 } from './campaign.ts';
import { copilot } from './copilot.ts';
import { layaState, stopLaya, warmLaya } from './laya.ts';
import { asPlayer, finishState } from './extras.ts';
import { createBackups, mergeInto, parsePick, restoreInto } from './backup.ts';
import { loadConfig } from './config.ts';
import { canSeeScene } from './perms.ts';
import { createSigner } from './signed.ts';
import { canSee, chatFor, redact, createRoom, filterFor, genCode, handle, joinRoom, normCode, sha, sweepHolds, type MemberRec, type Room, type RollFn } from './room.ts';

const SCENE_MSGS = ['draw', 'cursor', 'route', 'focus', 'regionMsg', 'spellBanner', 'reactionPrompt']; // difusiones ligadas al mapa: no van a quien no ve la escena
const MAX_IMPORT = 250 * 1024 * 1024, MAX_UVTT = 60 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'video/webm': 'webm', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
const TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'video/webm', mp4: 'video/mp4', pdf: 'application/pdf' };

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.wasm': 'application/wasm', '.ogg': 'audio/ogg' };
// Límites (seguridad). ponytail: contadores en memoria, se pierden al reiniciar; suficiente para un servidor único.
const WS_RATE = 30, WS_BURST = 60, WS_MAX_EXCESS = 10, MAX_CONN_IP = 20, MAX_ROOMS_IP_DAY = 200, MAX_UPLOADS = 30, MAX_PLAYER_UPLOADS = 10, MAX_PLAYER_ASSET = 5 * 1024 * 1024, UPLOAD_WINDOW = 10 * 60_000, DAY = 86_400_000;

// Ejecutable único (Node SEA): la web viaja como assets `web/<ruta>` dentro del binario.
const sea = process.getBuiltinModule('node:sea');
const VERSION = process.env.LANTERN_VERSION ?? (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version; // esbuild fija LANTERN_VERSION en el SEA
const seaAsset = (p: string) => { try { return Buffer.from(sea.getAsset('web' + p)); } catch { return null; } };
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const digest = (s: string) => createHash('sha256').update(s).digest();

type Conn = { room: Room; member: MemberRec; sid?: string };

export function start(port = Number(process.env.PORT ?? 8787), dbPath?: string, rollFn: RollFn = roll) {
  const webRoot = resolve(process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname);
  const serveWeb = sea.isSea() || existsSync(join(webRoot, 'index.html'));
  const ipOf = (req: IncomingMessage) => (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim()) || req.socket.remoteAddress || '?'; // con proxy, la última entrada la añade el propio proxy
  const connsByIp = new Map<string, number>();
  const roomsByIp = new Map<string, { n: number; reset: number }>();
  const uploads = new Map<string, { n: number; reset: number }>(), playerUploads = new Map<string, { n: number; reset: number }>();
  const hit = (m: Map<string, { n: number; reset: number }>, ip: string, max: number, win: number) => { // true = permitido
    const now = Date.now(); let e = m.get(ip);
    if (!e || e.reset <= now) { for (const [k, v] of m) if (v.reset <= now) m.delete(k); e = { n: 0, reset: now + win }; m.set(ip, e); }
    return ++e.n <= max ? 0 : Math.ceil((e.reset - now) / 1000);
  };
  const db = openDb(dbPath);
  const dbFile = dbPath ?? process.env.LANTERN_DB ?? 'lantern.db';
  const backups = createBackups(process.env.LANTERN_BACKUP_DIR ?? (dbFile === ':memory:' ? undefined : join(dirname(resolve(dbFile)), 'backups')));
  const rooms = new Map<string, Room>();
  const conns = new Map<WebSocket, Conn>();
  const seqs = new Map<string, number>(); // `${memberId}:${sid}` → último `s` procesado: reenvíos tras un corte no se duplican
  // ponytail: en memoria y sin caducar; un reinicio del servidor pierde la deduplicación (y sus mensajes en vuelo)
  const timers = new Map<string, NodeJS.Timeout>();
  // ponytail: las mesas nunca se expulsan de memoria; añadir evicción por inactividad si hace falta

  const getRoom = (code: string) => {
    let r = rooms.get(code);
    if (!r) { r = db.load(code) ?? undefined; if (r) rooms.set(code, r); }
    return r;
  };
  const dirty = (r: Room) => {
    if (timers.has(r.code)) return;
    timers.set(r.code, setTimeout(() => { timers.delete(r.code); db.save(r); }, 500).unref());
  };
  const signer = process.env.LANTERN_SIGNED_ASSETS === '1' ? createSigner() : undefined; // secreto por arranque: al reiniciar, los clientes reciben URLs nuevas al reconectar
  // Errores de protocolo a stdout: hora, tipo/op del C2S, texto y rol; sin contenido, claves ni nombres. Máx. 1 línea por (t,error) cada 10 s + contador.
  const cur = new WeakMap<WebSocket, { t?: unknown; op?: unknown }>(), errLog = new Map<string, { at: number; skipped: number }>();
  const tag = (v: unknown) => typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : '?';
  const logErr = (ws: WebSocket, text: string) => {
    const c = cur.get(ws), k = `${tag(c?.t)}|${text}`, now = Date.now(), e = errLog.get(k);
    if (e && now - e.at < 10_000) { e.skipped++; return; }
    if (errLog.size > 200) errLog.clear();
    errLog.set(k, { at: now, skipped: 0 });
    console.log(`${new Date(now).toISOString()} protocolo: error "${text}" t=${tag(c?.t)}${c?.op === undefined ? '' : ` op=${tag(c.op)}`} rol=${conns.get(ws)?.member.role ?? 'sin-join'}${e?.skipped ? ` (+${e.skipped} omitidos)` : ''}`);
  };
  const send = (ws: WebSocket, m: S2C) => (m.t === 'error' && (logErr(ws, m.msg), m = { ...m, re: tag(cur.get(ws)?.t) }), ws.readyState === ws.OPEN && ws.send(signer ? signer.sign(JSON.stringify(m)) : JSON.stringify(m)));
  const online = (r: Room) => new Set([...conns.values()].filter((c) => c.room === r).map((c) => c.member.id as Id));
  const broadcastState = (r: Room) => {
    const on = online(r);
    for (const [ws, c] of conns) if (c.room === r) send(ws, { t: 'state', state: finishState(r, c.member, filterFor(r, c.member, on)) });
  };

  const assets = process.env.LANTERN_ASSETS ?? './assets';
  const fail = (req: IncomingMessage, res: ServerResponse, code: number) => { // responde y corta el stream de subida
    res.writeHead(code, { connection: 'close' });
    res.end(() => req.destroy());
  };
  // Autenticación de las rutas HTTP: cabeceras de código y key de un miembro de la mesa.
  const auth = (req: IncomingMessage) => {
    const code = req.headers['x-lantern-code'], key = req.headers['x-lantern-key'];
    const room = typeof code === 'string' && code.length < 32 ? getRoom(normCode(code)) : undefined;
    const h = typeof key === 'string' && key.length < 200 ? sha(key) : '';
    const who = h && [...(room?.members.values() ?? [])].find((m) => m.keyHashes.includes(h));
    return room && who ? { room, who } : null;
  };
  const readBody = async (req: IncomingMessage, res: ServerResponse, max: number) => {
    if (Number(req.headers['content-length']) > max) return void fail(req, res, 413);
    const parts: Buffer[] = []; let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > max) return void fail(req, res, 413);
      parts.push(c);
    }
    return Buffer.concat(parts);
  };
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const jsonBody = async (req: IncomingMessage, res: ServerResponse, max: number) => {
    const b = await readBody(req, res, max);
    if (!b) return undefined;
    try { return JSON.parse(b.toString()) as unknown; } catch { json(res, 400, { error: 'JSON inválido' }); return undefined; }
  };
  const web = async (req: IncomingMessage, res: ServerResponse) => {
    let p: string;
    try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.statusCode = 400; res.end(); return; }
    if (p.includes('\0') || /^\/(api|assets|ws)(\/|$)/.test(p)) { res.statusCode = 404; res.end(); return; }
    let file = resolve(webRoot, '.' + p);
    if (file !== webRoot && !file.startsWith(webRoot + sep)) { res.statusCode = 404; res.end(); return; }
    const read = (f: string, rel: string) => sea.isSea() ? seaAsset(rel) : readFile(f).catch(() => null);
    let data = await read(file, p);
    if (!data && !p.startsWith('/static/') && !extname(p)) { file = join(webRoot, 'index.html'); data = await read(file, '/index.html'); } // SPA
    if (!data) { res.statusCode = 404; res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': data.length, 'x-content-type-options': 'nosniff', 'cache-control': p.startsWith('/static/') ? 'public, max-age=31536000, immutable' : p.startsWith('/audio/') ? 'public, max-age=604800' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
  // Administración para el instalador: solo loopback (y sin cabeceras de proxy/túnel) + LANTERN_ADMIN_TOKEN. Sin token, desactivada.
  const admin = async (req: IncomingMessage, res: ServerResponse) => {
    const token = process.env.LANTERN_ADMIN_TOKEN;
    if (!token) return json(res, 404, { error: 'administración desactivada' });
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['cf-connecting-ip']) return json(res, 403, { error: 'solo desde localhost' });
    const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    if (!timingSafeEqual(digest(given), digest(token))) return json(res, 401, { error: 'token incorrecto' });
    const [path, query = ''] = (req.url ?? '').split('?');
    const origin = (process.env.LANTERN_ORIGIN || `http://localhost:${(http.address() as { port: number }).port}`).replace(/\/+$/, '');
    if (req.method === 'GET' && path === '/admin/status') {
      const n = (db.raw.prepare('SELECT count(*) AS n FROM rooms').get() as { n: number }).n;
      return json(res, 200, { version: VERSION, rooms: n, llm: !!process.env.LANTERN_LLM_URL, laya: layaState(), origin });
    }
    if (req.method === 'POST' && path === '/admin/bootstrap') {
      const v = await jsonBody(req, res, 4096) as { dmName?: unknown; title?: unknown } | undefined;
      if (v === undefined) return;
      const made = createRoom(v?.dmName, genCode((c) => rooms.has(c) || db.exists(c)));
      if ('error' in made) return json(res, 400, made);
      const { room, key } = made;
      if (typeof v?.title === 'string' && v.title.trim()) room.scene.name = v.title.trim().slice(0, 60);
      rooms.set(room.code, room); db.save(room);
      return json(res, 200, { code: room.code, inviteUrl: `${origin}/?code=${room.code}`, dmUrl: `${origin}/?code=${room.code}#k=${encodeURIComponent(key)}` });
    }
    if (req.method === 'POST' && path === '/admin/import') {
      const q = new URLSearchParams(query), kind = q.get('kind'), room = getRoom(normCode(q.get('code') ?? ''));
      if (!room) return json(res, 404, { error: 'mesa inexistente' });
      if (kind !== 'lantern' && kind !== 'uvtt') return json(res, 400, { error: 'kind debe ser lantern o uvtt' });
      const v = await jsonBody(req, res, kind === 'uvtt' ? MAX_UVTT : MAX_IMPORT);
      if (v === undefined) return;
      mkdirSync(assets, { recursive: true });
      let summary: unknown;
      if (kind === 'lantern') { // se incorpora todo a la mesa existente, como la fusión selectiva con todo marcado
        const imp = importCampaign(v);
        if ('error' in imp) return json(res, 400, imp);
        summary = mergeInto(room, imp, { scenes: imp.scenes.map((s) => s.id), journal: imp.journal.map((e) => e.id), characters: imp.scenes.flatMap((s) => s.tokens.map((t) => t.id)) });
        for (const [name, data] of imp.assets) await writeFile(join(assets, name), data);
      } else {
        const r = parseUvtt(v);
        if ('error' in r) return json(res, r.status ?? 400, { error: r.error });
        if (Object.keys(room.scenes).length >= MAX_SCENES) return json(res, 400, { error: 'demasiadas escenas' });
        if (r.image) await writeFile(join(assets, r.image.name), r.image.data);
        room.scenes[r.scene.id] = r.scene; summary = { sceneId: r.scene.id };
      }
      broadcastState(room); dirty(room);
      return json(res, 200, { ok: true, summary });
    }
    return json(res, 404, { error: 'no encontrado' });
  };
  const accounts = createAccounts(db.raw, { getRoom, dirty });
  const http = createServer(async (req, res) => {
    if (await accounts.handle(req, res)) return;
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.url?.startsWith('/admin/')) return void await admin(req, res);
    if (req.method === 'POST' && (req.url === '/api/assets' || req.url === '/api/import' || req.url === '/api/merge' || req.url === '/api/uvtt')) {
      const wait = hit(uploads, ipOf(req), MAX_UPLOADS, UPLOAD_WINDOW);
      if (wait) { res.writeHead(429, { 'retry-after': String(wait), connection: 'close' }); res.end(() => req.destroy()); return; }
    }
    if (req.method === 'POST' && req.url === '/api/assets') {
      const a = auth(req), type = req.headers['content-type'] ?? '';
      const priv = !!a && ['dm', 'assistant', 'trusted'].includes(a.who.role);
      if (!a || (!priv && a.who.role !== 'player')) return fail(req, res, 403);
      const ext = EXT[type];
      if (!ext || (!priv && !['image/png', 'image/jpeg', 'image/webp'].includes(type))) return fail(req, res, 415); // jugadores: solo imágenes
      if (!priv && hit(playerUploads, ipOf(req), MAX_PLAYER_UPLOADS, UPLOAD_WINDOW)) return fail(req, res, 429); // límite propio por IP
      const body = await readBody(req, res, priv ? MAX_ASSET : MAX_PLAYER_ASSET);
      if (!body) return;
      if (ext === 'pdf' && body.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(req, res, 415);
      const name = sha256(body) + '.' + ext;
      mkdirSync(assets, { recursive: true });
      await writeFile(join(assets, name), body);
      const attr = req.headers['x-lantern-attr']; // atribución (Openverse, game-icons…): se guarda junto al recurso
      if (priv && typeof attr === 'string' && attr.length < 3000) try {
        const j = JSON.parse(decodeURIComponent(attr)) as Record<string, unknown>, cut = (k: string) => typeof j[k] === 'string' ? (j[k] as string).slice(0, 300) : undefined;
        await writeFile(join(assets, name + '.attr.json'), JSON.stringify({ title: cut('title'), creator: cut('creator'), license: cut('license'), url: cut('url'), source: cut('source') }));
      } catch { /* atribución mal formada: se ignora */ }
      res.setHeader('content-type', 'application/json'); const out = JSON.stringify({ url: '/assets/' + name }); res.end(signer ? signer.sign(out) : out);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/credits') { // atribuciones de los recursos usados en la mesa
      const a = auth(req);
      if (!a) return fail(req, res, 403);
      const names = new Set([...JSON.stringify([a.room.scenes, a.room.journal]).matchAll(/\/assets\/([0-9a-f]{64}\.(?:png|jpg|webp))/g)].map((m) => m[1]));
      const out: unknown[] = [];
      for (const n of names) { const t = await readFile(join(assets, n + '.attr.json'), 'utf8').catch(() => null); if (t) try { out.push({ asset: n, ...JSON.parse(t) }); } catch { /* sidecar roto */ } }
      return json(res, 200, out);
    }
    if (req.url === '/api/export' || req.url === '/api/import' || req.url === '/api/merge' || req.url === '/api/uvtt') {
      const a = auth(req);
      if (!a || a.who.role !== 'dm') return fail(req, res, 403);
      if (req.url === '/api/export' && req.method === 'GET') {
        const out = await exportCampaign(a.room, (n) => readFile(join(assets, n)).catch(() => null));
        if (out === 'tooLarge') return json(res, 413, { error: 'la campaña supera 200 MB' });
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="lantern-${a.room.code}.json"` });
        res.end(JSON.stringify(out));
        return;
      }
      if (req.url === '/api/import' && req.method === 'POST') {
        const v = await jsonBody(req, res, MAX_IMPORT);
        if (v === undefined) return;
        const imp = importCampaign(v);
        if ('error' in imp) return json(res, 400, imp);
        const made = createRoom(a.who.name, genCode((c) => rooms.has(c) || db.exists(c)), imp.scenes[0]);
        if ('error' in made) return json(res, 400, made);
        const { room, key } = made;
        room.scenes = Object.fromEntries(imp.scenes.map((s) => [s.id, s])); room.activeId = imp.activeId;
        room.journal = imp.journal; room.settings = imp.settings;
        mkdirSync(assets, { recursive: true });
        for (const [name, data] of imp.assets) await writeFile(join(assets, name), data);
        rooms.set(room.code, room);
        db.save(room);
        return json(res, 200, { code: room.code, key });
      }
      if (req.url === '/api/merge' && req.method === 'POST') { // fusión selectiva: solo lo elegido entra en esta mesa
        const v = await jsonBody(req, res, MAX_IMPORT);
        if (v === undefined) return;
        const imp = importCampaign(v), pick = parsePick((v as { select?: unknown }).select);
        if ('error' in imp || !pick) return json(res, 400, { error: 'error' in imp ? imp.error : 'selección inválida' });
        const n = mergeInto(a.room, imp, pick);
        mkdirSync(assets, { recursive: true });
        for (const [name, data] of imp.assets) await writeFile(join(assets, name), data);
        broadcastState(a.room); dirty(a.room);
        return json(res, 200, n);
      }
      if (req.url === '/api/uvtt' && req.method === 'POST') {
        const v = await jsonBody(req, res, MAX_UVTT);
        if (v === undefined) return;
        const r = parseUvtt(v);
        if ('error' in r) return json(res, r.status ?? 400, { error: r.error });
        if (Object.keys(a.room.scenes).length >= MAX_SCENES) return json(res, 400, { error: 'demasiadas escenas' });
        if (r.image) { mkdirSync(assets, { recursive: true }); await writeFile(join(assets, r.image.name), r.image.data); }
        a.room.scenes[r.scene.id] = r.scene; // no se activa
        broadcastState(a.room); dirty(a.room);
        return json(res, 200, { sceneId: r.scene.id });
      }
      return fail(req, res, 405);
    }
    const [aPath, aQuery = ''] = (req.url ?? '').split('?');
    const f = req.method === 'GET' && /^\/assets\/([0-9a-f]{64}\.(png|jpg|webp|mp3|ogg|webm|mp4|pdf))$/.exec(aPath);
    if (f && signer && !signer.verify(f[1], new URLSearchParams(aQuery))) { res.writeHead(403, { 'cache-control': 'no-store' }); res.end(); return; }
    if (f) {
      // Range es necesario para que <audio>/<video> puedan saltar (sincronizar el jukebox a mitad de pista).
      // ponytail: el archivo entero en memoria (≤25 MB); .webm se sirve como video/webm también para audio.
      const data = await readFile(join(assets, f[1])).catch(() => null);
      if (data) {
        const head = { 'content-type': TYPE[f[2]], ...(f[2] === 'pdf' && { 'content-disposition': 'inline' }), 'cache-control': `${signer ? 'private' : 'public'}, max-age=31536000, immutable`, 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
        const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (r && (r[1] || r[2])) {
          const size = data.length;
          let start = r[1] ? Number(r[1]) : size - Number(r[2]), end = r[1] && r[2] ? Number(r[2]) : size - 1;
          start = Math.max(0, start); end = Math.min(end, size - 1);
          if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
          res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
          res.end(data.subarray(start, end + 1)); return;
        }
        res.writeHead(200, { ...head, 'content-length': data.length });
        res.end(data); return;
      }
    }
    if (serveWeb && (req.method === 'GET' || req.method === 'HEAD')) return web(req, res);
    res.statusCode = 404; res.end();
  });
  // Difunde un Effect a la mesa (ws: quien lo provocó, para el reloj)
  const deliver = (room: Room, fx: ReturnType<typeof handle>, ws?: WebSocket) => {
    for (const cm of [fx.chat, ...(fx.chats ?? [])]) if (cm) for (const [w, c] of conns) if (c.room === room && canSee(cm, c.member)) send(w, { t: 'chat', msg: redact(room, cm, c.member) as ChatMsg });
    if (fx.ping) for (const [w, c] of conns) if (c.room === room && canSeeScene(room.scene, c.member)) send(w, { t: 'ping', ...fx.ping });
    if (fx.all) for (const [w, c] of conns) if (c.room === room && (canSeeScene(room.scene, c.member) || !SCENE_MSGS.includes(fx.all.t))) send(w, fx.all);
    for (const sd of fx.sends ?? []) for (const [w, c] of conns) if (c.room === room && sd.who(c.member)) send(w, sd.msg);
    if (fx.to) for (const [w, c] of conns) if (c.room === room && c.member.id === fx.to.id) send(w, fx.to.msg);
    if (fx.clock) ws && send(ws, { t: 'clock', now: Date.now() });
    if (fx.state) broadcastState(room);
    dirty(room);
  };
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req), n = connsByIp.get(ip) ?? 0;
    if (n >= MAX_CONN_IP) return ws.close(1008, 'demasiadas conexiones');
    connsByIp.set(ip, n + 1);
    ws.on('close', () => { const k = (connsByIp.get(ip) ?? 1) - 1; if (k > 0) connsByIp.set(ip, k); else connsByIp.delete(ip); });
    let bucket = WS_BURST, last = Date.now(), excess = 0; // token bucket por conexión
    ws.on('message', (raw) => {
      const now = Date.now();
      bucket = Math.min(WS_BURST, bucket + (now - last) * WS_RATE / 1000); last = now;
      if (bucket < 1) {
        if (++excess > WS_MAX_EXCESS) { send(ws, { t: 'error', msg: 'demasiados mensajes' }); ws.close(1008, 'rate limit'); }
        return;
      }
      bucket--; excess = 0;
      let msg: any;
      cur.delete(ws);
      try { msg = JSON.parse(signer ? signer.strip(raw.toString()) : raw.toString()); } catch { return send(ws, { t: 'error', msg: 'JSON inválido' }); }
      if (typeof msg !== 'object' || msg === null) return send(ws, { t: 'error', msg: 'mensaje inválido' });
      cur.set(ws, { t: msg.t, op: msg.op });
      const conn = conns.get(ws);

      if (msg.t === 'join') {
        if (conn) return send(ws, { t: 'error', msg: 'ya estás en una mesa' });
        let room: Room | undefined, member: MemberRec, key: string;
        if (msg.code === undefined) {
          const wait = hit(roomsByIp, ip, MAX_ROOMS_IP_DAY, DAY);
          if (wait) return send(ws, { t: 'error', msg: 'demasiadas mesas creadas hoy desde tu IP' });
          const r = createRoom(msg.name, genCode((c) => rooms.has(c) || db.exists(c)));
          if ('error' in r) return send(ws, { t: 'error', msg: r.error });
          room = r.room; member = r.member; key = r.key;
          rooms.set(room.code, room);
        } else {
          room = typeof msg.code === 'string' ? getRoom(normCode(msg.code)) : undefined;
          if (!room) return send(ws, { t: 'error', msg: 'mesa inexistente' });
          const r = joinRoom(room, msg.name, msg.key, (msg as { as?: unknown }).as);
          if ('error' in r) return send(ws, { t: 'error', msg: r.error });
          member = r.member; key = r.key ?? (msg.key as string);
        }
        const sid = typeof msg.sid === 'string' ? msg.sid.slice(0, 40) : undefined;
        conns.set(ws, { room, member, sid });
        dirty(room);
        send(ws, { t: 'welcome', memberId: member.id, key, role: member.role, state: finishState(room, member, filterFor(room, member, online(room))), chat: chatFor(room, member), v: PROTOCOL_VERSION, seq: sid ? seqs.get(`${member.id}:${sid}`) ?? 0 : undefined });
        send(ws, { t: 'clock', now: Date.now() });
    broadcastState(room); // el resto ve el nuevo miembro / online
        return;
      }

      if (!conn) return send(ws, { t: 'error', msg: 'primero join' });
      const { room, member } = conn;
      if (conn.sid && typeof msg.s === 'number') {
        const k = `${member.id}:${conn.sid}`;
        if (msg.s <= (seqs.get(k) ?? 0)) return; // duplicado de un reenvío
        seqs.set(k, msg.s);
      }
      // Las respuestas asíncronas van al socket vivo de la misma pestaña (member + sid): si se cortó mientras tanto,
      // el cliente ya reconectó y no va a reenviar la petición (el seq la dio por recibida).
      const reply = () => conns.has(ws) || !conn.sid ? ws : [...conns].find(([, c]) => c.room === room && c.member.id === member.id && c.sid === conn.sid)?.[0] ?? ws;
      if (msg.t === 'copilot') { // async: no bloquea el resto de la mesa; responde solo a quien preguntó
        void copilot(room, member, msg).then((r) => { const to = reply(); cur.set(to, { t: msg.t, op: msg.op }); send(to, r.msg); if (r.state) { broadcastState(room); dirty(room); } });
        return;
      }
      if (msg.t === 'asPlayer') { // vista «como jugador X» solo para el DM
        const r = asPlayer(room, member, msg, online(room));
        return send(ws, 'error' in r ? { t: 'error', msg: r.error } : { t: 'asState', memberId: msg.memberId ?? null, state: r.state });
      }
      if (msg.t === 'backup') {
        if (member.role !== 'dm') return send(ws, { t: 'error', msg: 'no permitido' });
        if (!backups.enabled) return send(ws, { t: 'error', msg: 'copias desactivadas en este servidor' });
        void (async () => {
          cur.set(ws, { t: msg.t, op: msg.op });
          if (msg.op === 'now') await backups.save(room);
          else if (msg.op === 'restore') {
            const err = restoreInto(room, backups.read(room.code, msg.name));
            if (err) return send(reply(), { t: 'error', msg: `no se pudo restaurar: ${err}` });
            broadcastState(room); dirty(room);
          } else if (msg.op !== 'list') return send(ws, { t: 'error', msg: 'mensaje inválido' });
          send(reply(), { t: 'backups', list: backups.list(room.code) });
        })();
        return;
      }
      const fx = handle(room, member, msg, rollFn);
      if (msg.t === 'sessionEnd' && !fx.error) void backups.save(room); // copia al cerrar la sesión
      if (fx.error) return send(ws, { t: 'error', msg: fx.error });
      deliver(room, fx, ws);
    });
    ws.on('close', () => {
      const c = conns.get(ws);
      conns.delete(ws);
      if (c) broadcastState(c.room);
    });
    ws.on('error', () => ws.terminate());
  });

  const bk = backups.enabled ? setInterval(() => { for (const r of rooms.values()) void backups.save(r); }, Number(process.env.LANTERN_BACKUP_MIN ?? 10) * 60_000).unref() : undefined;
  // salvaciones de jugadores: caducan a su hora aunque nadie escriba
  const sweep = setInterval(() => { for (const r of rooms.values()) { const fx = sweepHolds(r, rollFn); if (fx) deliver(r, fx); } }, 1000).unref();
  http.listen(port, process.env.HOST ?? '0.0.0.0');
  warmLaya();
  return {
    port: () => (http.address() as { port: number }).port,
    ready: new Promise<void>((ok) => http.once('listening', ok)),
    close: () => new Promise<void>((done) => {
      clearInterval(bk); clearInterval(sweep); stopLaya();
      for (const [code, t] of timers) { clearTimeout(t); const r = rooms.get(code); if (r) db.save(r); }
      timers.clear();
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => http.close(() => { db.close(); done(); }));
    }),
  };
}

if (sea.isSea() || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  if (process.argv.includes('--version')) { console.log(VERSION); process.exit(0); }
  loadConfig();
  start();
  console.log(`lantern server en ${process.env.HOST ?? '0.0.0.0'}:${process.env.PORT ?? 8787}`);
}
