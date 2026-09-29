// Ejecutable único `lantern-server` (Node SEA): npm run sea → dist-bin/lantern-server-<os>-<arch>[.exe]
// Empaqueta el servidor (esbuild → un CJS), embebe apps/web/dist y tools/laya/sidecar.py como assets y lo inyecta en una copia de este node.
// macOS: se re-firma ad hoc (codesign --sign -); para distribuir usa un certificado de Developer ID.
// Windows: si node.exe está firmado hay que quitar la firma antes (`signtool remove /s`) y firmar el resultado (`signtool sign …`).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'dist-bin'), DIST = join(ROOT, 'apps/web/dist');
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falló`); };
const os = { darwin: 'macos', win32: 'windows' }[process.platform] ?? process.platform, exe = process.platform === 'win32' ? '.exe' : '';
const target = join(OUT, `lantern-server-${os}-${process.arch}${exe}`);
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

if (!existsSync(join(DIST, 'index.html'))) run('npm', ['run', 'build', '-w', 'apps/web']);
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, 'apps/server/src/main.ts')], outfile: join(OUT, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'warning',
  external: ['bufferutil', 'utf-8-validate'], // opcionales de ws
  define: { 'import.meta.url': '__importMetaUrl', 'process.env.LANTERN_VERSION': JSON.stringify(version) },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
});

const assets = { 'sidecar.py': join(ROOT, 'tools/laya/sidecar.py') };
for (const f of walk(DIST)) assets['web/' + relative(DIST, f).split('\\').join('/')] = f;
writeFileSync(join(OUT, 'sea-config.json'), JSON.stringify({ main: join(OUT, 'server.cjs'), output: join(OUT, 'sea.blob'), disableExperimentalSEAWarning: true, assets }));
run(process.execPath, ['--experimental-sea-config', join(OUT, 'sea-config.json')]);

copyFileSync(process.execPath, target); chmodSync(target, 0o755);
if (process.platform === 'darwin') spawnSync('codesign', ['--remove-signature', target], { stdio: 'inherit' });
await inject(target, 'NODE_SEA_BLOB', readFileSync(join(OUT, 'sea.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' && { machoSegmentName: 'NODE_SEA' }),
});
if (process.platform === 'darwin') run('codesign', ['--sign', '-', target]);
console.log('listo:', target);
