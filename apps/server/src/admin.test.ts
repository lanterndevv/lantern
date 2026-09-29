import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { start } from './main.ts';

const TOKEN = 'tok-secreto-123';
async function withServer(f: (base: string, call: (path: string, init?: RequestInit & { token?: string | null }) => Promise<Response>) => Promise<void>) {
  process.env.HOST = '0.0.0.0'; process.env.LANTERN_LAYA = '0'; process.env.LANTERN_ORIGIN = 'https://mesa.example.com/';
  const srv = start(0, ':memory:'); await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  const call = (path: string, init: RequestInit & { token?: string | null } = {}) => fetch(base + path, { ...init, headers: { ...(init.token !== null && { authorization: `Bearer ${init.token ?? TOKEN}` }), ...init.headers } });
  try { await f(base, call); } finally { await srv.close(); delete process.env.HOST; delete process.env.LANTERN_LAYA; delete process.env.LANTERN_ORIGIN; delete process.env.LANTERN_ADMIN_TOKEN; }
}

test('admin: sin LANTERN_ADMIN_TOKEN está desactivado; token incorrecto → 401', async () => {
  delete process.env.LANTERN_ADMIN_TOKEN;
  await withServer(async (_b, call) => { assert.equal((await call('/admin/status')).status, 404); });
  process.env.LANTERN_ADMIN_TOKEN = TOKEN;
  await withServer(async (_b, call) => {
    assert.equal((await call('/admin/status', { token: 'otro' })).status, 401);
    assert.equal((await call('/admin/status', { token: null })).status, 401);
    assert.equal((await call('/admin/status')).status, 200);
  });
});

test('admin: fuera de localhost → 403 (proxy/túnel o IP no local)', async () => {
  process.env.LANTERN_ADMIN_TOKEN = TOKEN;
  await withServer(async (base, call) => {
    assert.equal((await call('/admin/status', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 403);
    const ext = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    if (ext) assert.equal((await fetch(`http://${ext}:${new URL(base).port}/admin/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 403);
  });
});

test('admin: status, bootstrap (dmUrl con #k=) e import lantern/uvtt', async () => {
  process.env.LANTERN_ADMIN_TOKEN = TOKEN;
  await withServer(async (_b, call) => {
    const st = await (await call('/admin/status')).json() as any;
    assert.deepEqual([st.rooms, st.llm, st.laya, st.origin], [0, false, 'off', 'https://mesa.example.com']);
    assert.match(st.version, /^\d+\.\d+\.\d+/);
    const bad = await call('/admin/bootstrap', { method: 'POST', body: JSON.stringify({ dmName: '' }) });
    assert.equal(bad.status, 400);
    const b = await (await call('/admin/bootstrap', { method: 'POST', body: JSON.stringify({ dmName: 'Ana', title: 'Mi mesa' }) })).json() as any;
    assert.match(b.code, /^[A-Z0-9]{6}$/);
    assert.equal(b.inviteUrl, `https://mesa.example.com/?code=${b.code}`);
    assert.match(b.dmUrl, new RegExp(`^https://mesa\\.example\\.com/\\?code=${b.code}#k=.+`));
    assert.equal(((await (await call('/admin/status')).json()) as any).rooms, 1);

    const uvtt = { resolution: { map_size: { x: 4, y: 4 }, pixels_per_grid: 50 }, line_of_sight: [[{ x: 0, y: 0 }, { x: 4, y: 0 }]] };
    const u = await call(`/admin/import?code=${b.code}&kind=uvtt`, { method: 'POST', body: JSON.stringify(uvtt) });
    assert.equal(u.status, 200); const uj = await u.json() as any; assert.ok(uj.ok && uj.summary.sceneId);

    const camp = { format: 'lantern-campaign', version: 1, scenes: [{ id: 's1', name: 'Extra', width: 500, height: 500, grid: { size: 50, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 }], journal: [] };
    const c = await call(`/admin/import?code=${b.code}&kind=lantern`, { method: 'POST', body: JSON.stringify(camp) });
    const cj = await c.json() as any; assert.equal(c.status, 200, JSON.stringify(cj)); assert.equal(cj.summary.scenes, 1);
    assert.equal((await call(`/admin/import?code=ZZZZZZ&kind=lantern`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await call(`/admin/import?code=${b.code}&kind=lantern`, { method: 'POST', body: '{"x":1}' })).status, 400);
  });
});
