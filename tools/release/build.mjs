// npm run release -- <versión> [--releases-url URL] [--image IMG]
// Genera dist-release/<versión>/ desde cualquier Linux x64: lantern-server-* (Node SEA) y lantern-installer-* (Go) para 5 plataformas + SHA256SUMS.
// Los node de cada plataforma se descargan de nodejs.org (misma versión que el node local, verificados con SHASUMS256.txt) y se cachean en ~/.cache/lantern-release.
// macOS: firma ad hoc con rcodesign (apple-codesign). Sin certificado Developer ID, Gatekeeper avisa igualmente ("clic derecho > Abrir" o `xattr -d com.apple.quarantine`).
// Windows: el .exe queda sin firma Authenticode (la de node.exe se invalida al inyectar): SmartScreen mostrará un aviso la primera vez.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import { inject } from 'postject';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'lantern-release');
const RCODESIGN = '0.29.0';
const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const releasesUrl = opt('--releases-url'), image = opt('--image');
const version = args[0];
if (!version || version.startsWith('-')) { console.error('uso: npm run release -- <versión> [--releases-url URL] [--image IMG]'); process.exit(2); }

const sh = (cmd, a, o = {}) => { const r = spawnSync(cmd, a, { stdio: 'inherit', ...o }); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} falló`); };
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
mkdirSync(CACHE, { recursive: true });

async function download(url, name) {
  const f = join(CACHE, name);
  if (!existsSync(f)) {
    console.log('descargando', url);
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    writeFileSync(f + '.part', Buffer.from(await r.arrayBuffer())); sh('mv', [f + '.part', f]);
  }
  return f;
}

// --- objetivos: nombre de release, archivo de node, ruta del ejecutable dentro del archivo, go os/arch
const nodeVer = process.version; // v24.18.0
const targets = [
  { name: 'linux-x64', node: 'linux-x64.tar.xz', bin: 'bin/node', go: ['linux', 'amd64'] },
  { name: 'linux-arm64', node: 'linux-arm64.tar.xz', bin: 'bin/node', go: ['linux', 'arm64'] },
  { name: 'macos-x64', node: 'darwin-x64.tar.gz', bin: 'bin/node', go: ['darwin', 'amd64'], mac: true },
  { name: 'macos-arm64', node: 'darwin-arm64.tar.gz', bin: 'bin/node', go: ['darwin', 'arm64'], mac: true },
  { name: 'windows-x64.exe', node: 'win-x64.zip', bin: 'node.exe', go: ['windows', 'amd64'], win: true },
];

// --- rcodesign (herramienta de firma ad hoc), en la caché
async function rcodesign() {
  const dir = `apple-codesign-${RCODESIGN}-x86_64-unknown-linux-musl`, bin = join(CACHE, dir, 'rcodesign');
  if (existsSync(bin)) return bin;
  const base = `https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN}/${dir}.tar.gz`;
  const tgz = await download(base, `${dir}.tar.gz`), want = (await (await fetch(base + '.sha256')).text()).trim().split(/\s+/)[0];
  if (sha(tgz) !== want) { rmSync(tgz); throw new Error('SHA256 de rcodesign no coincide'); }
  sh('tar', ['-xzf', tgz, '-C', CACHE]); return bin;
}

// --- blob SEA (una vez, con el node local)
const work = join(CACHE, 'work'); rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
sh('npm', ['run', 'build', '-w', 'apps/web'], { cwd: ROOT });
const DIST = join(ROOT, 'apps/web/dist');
await build({
  entryPoints: [join(ROOT, 'apps/server/src/main.ts')], outfile: join(work, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'warning',
  external: ['bufferutil', 'utf-8-validate'],
  define: { 'import.meta.url': '__importMetaUrl', 'process.env.LANTERN_VERSION': JSON.stringify(version) },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
});
const assets = { 'sidecar.py': join(ROOT, 'tools/laya/sidecar.py') };
for (const f of walk(DIST)) assets['web/' + relative(DIST, f).split('\\').join('/')] = f;
writeFileSync(join(work, 'sea-config.json'), JSON.stringify({ main: join(work, 'server.cjs'), output: join(work, 'sea.blob'), disableExperimentalSEAWarning: true, assets }));
sh(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')]);
const blob = readFileSync(join(work, 'sea.blob'));

// --- servidores
const OUT = join(ROOT, 'dist-release', version); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const sums = await (await fetch(`https://nodejs.org/dist/${nodeVer}/SHASUMS256.txt`)).text();
let rc;
for (const t of targets) {
  const file = `node-${nodeVer}-${t.node}`, tgz = await download(`https://nodejs.org/dist/${nodeVer}/${file}`, file);
  const want = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === file)?.[0];
  if (!want || sha(tgz) !== want) { rmSync(tgz, { force: true }); throw new Error(`SHA256 de ${file} no coincide con SHASUMS256.txt`); }
  const ex = join(work, t.name); mkdirSync(ex);
  sh(t.win ? 'unzip' : 'tar', t.win ? ['-q', tgz, '-d', ex] : ['-xf', tgz, '-C', ex]);
  const out = join(OUT, `lantern-server-${t.name}`);
  copyFileSync(join(ex, `node-${nodeVer}-${t.node.replace(/\.(tar\.(xz|gz)|zip)$/, '')}`, t.bin), out); chmodSync(out, 0o755);
  if (t.mac) { rc ??= await rcodesign(); } // rcodesign sign sustituye la firma de node (que la inyección invalida)
  await inject(out, 'NODE_SEA_BLOB', blob, { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(t.mac && { machoSegmentName: 'NODE_SEA' }) });
  if (t.mac) sh(rc, ['sign', out]); // ad hoc: sin identidad
  console.log('servidor', t.name);
}

// --- instaladores
const ld = ['-s -w', `-X main.version=${version}`, releasesUrl && `-X lantern/installer/lantern.DefaultReleases=${releasesUrl}`, image && `-X lantern/installer/lantern.DefaultImage=${image}`].filter(Boolean).join(' ');
for (const t of targets) {
  sh('go', ['build', '-trimpath', '-ldflags', ld, '-o', join(OUT, `lantern-installer-${t.name}`), '.'], { cwd: join(ROOT, 'installer'), env: { ...process.env, CGO_ENABLED: '0', GOOS: t.go[0], GOARCH: t.go[1] } });
  console.log('instalador', t.name);
}

// --- extensión Lantern Link: zip plano (manifest.json en la raíz) para «Cargar descomprimida»; sin herramienta externa
sh(process.execPath, [join(ROOT, 'apps/link/build.mjs')]);
{
  const names = ['manifest.json', 'background.js', 'content.js', 'ddb.js', 'gamelog.js', 'srd.js'], parts = [], central = [];
  let off = 0;
  for (const n of names) {
    const data = readFileSync(join(ROOT, 'apps/link', n)), z = deflateRawSync(data), nm = Buffer.from(n), c = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0x00210000, 10); h.writeUInt32LE(c, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26); // fecha fija 1980-01-01: zip reproducible
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); h.copy(d, 6, 4, 30); d.writeUInt32LE(off, 42);
    parts.push(h, nm, z); central.push(d, nm); off += 30 + nm.length + z.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  writeFileSync(join(OUT, `lantern-link-${version.replace(/^v/, '')}.zip`), Buffer.concat([...parts, cd, e]));
  console.log('extensión lantern-link');
}

for (const f of ['install.sh', 'install.ps1']) copyFileSync(join(ROOT, f), join(OUT, f)); // por si alguien prefiere bajarlos de la release
const files = readdirSync(OUT).filter((f) => f !== 'SHA256SUMS').sort();
writeFileSync(join(OUT, 'SHA256SUMS'), files.map((f) => `${sha(join(OUT, f))}  ${f}`).join('\n') + '\n');
console.log('listo:', OUT);
