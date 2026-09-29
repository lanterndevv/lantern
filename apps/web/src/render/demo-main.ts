// Demo del renderer: /render-demo.html (?dm=1 = vista DM sin niebla)
import { demoScene } from '@lantern/protocol/demo';
import { DEFAULT_SETTINGS } from '@lantern/protocol';
import type { ClientState, Point } from '@lantern/protocol';
import { sightSegments, visibility } from '@lantern/vision';
import type { Marks } from './api.ts';
import { createTable } from './table.ts';

const dm = new URLSearchParams(location.search).get('dm') === '1';
const scene = demoScene();
scene.tokens.find((t) => t.id === 'kael')!.owners = ['yo'];
const tk = (id: string) => scene.tokens.find((t) => t.id === id)!;
Object.assign(tk('trasgo-a'), { conditions: ['poisoned'], condRounds: { poisoned: 2 } });
Object.assign(tk('ysolde'), { concentration: 'Bendición', exhaustion: 2 });
Object.assign(tk('nix'), { conditions: ['invisible', 'prone', 'frightened'] });
Object.assign(tk('brida'), { conditions: ['unconscious'], deathSaves: { successes: 1, failures: 1 } });
document.body.style.cssText = 'margin:0;overflow:hidden;background:#070504';

// ponytail: visión en el cliente solo para la demo (en producción la calcula el servidor)
const vis = (): Point[][] =>
  scene.tokens.filter((t) => t.faction === 'ally').map((t) => visibility(t, sightSegments(scene.walls), scene.width, scene.height));
const state = (): ClientState => ({
  code: 'DEMO', members: [{ id: 'yo', name: 'Yo', role: dm ? 'dm' : 'player', online: true, dice: 'linterna' }],
  scene: structuredClone(scene), automation: 'assisted', view: 'tactical', audio: { layers: [] }, settings: DEFAULT_SETTINGS, visible: dm ? undefined : vis(),
});

const marks: Marks = { targets: [] };
const table = await createTable(document.body, {
  role: dm ? 'dm' : 'player', memberId: 'yo',
  onMoveToken(id, x, y) {
    console.log('move', id, x, y);
    const t = scene.tokens.find((t) => t.id === id)!; t.x = x; t.y = y;
    table.setState(state());
  },
  onPing(x, y) { console.log('ping', x, y); table.ping(x, y, '#E8A33D'); },
  onTokenClick(id, shift) {
    marks.targets = shift ? [...new Set([...marks.targets, id])] : [id];
    table.setMarks(marks);
  },
  onMapClick(x, y) { marks.area = { x, y, radius: 240, color: '#E0643A' }; table.setMarks(marks); },
  onDoor(id, open) {
    console.log('door', id, open);
    scene.walls.find((w) => w.id === id)!.open = open;
    table.setState(state());
  },
});
table.setState(state());
table.setMarks(marks);
const at = (id: string) => ({ x: tk(id).x, y: tk(id).y });
const KINDS = ['none', 'rain', 'storm', 'snow', 'fog', 'ash', 'leaves', 'embers'] as const;
let wi = 0;
addEventListener('keydown', (e) => {
  if (e.key === 'n') {
    const ids = scene.tokens.map((t) => t.id), i = ids.indexOf(marks.active ?? '');
    marks.active = ids[(i + 1) % ids.length]; table.setMarks(marks);
  } else if (e.key === '1') table.effect({ kind: 'projectile', from: at('kael'), to: at('trasgo-b'), damageType: 'fire' });
  else if (e.key === '2') table.effect({ kind: 'projectile', from: at('kael'), to: at('trasgo-b'), damageType: 'lightning' });
  else if (e.key === '3') table.effect({ kind: 'burst', at: at('osgo'), radius: 240, damageType: 'fire' });
  else if (e.key === '4') table.effect({ kind: 'heal', at: at('brida') });
  else if (e.key === '5') { table.effect({ kind: 'projectile', from: at('kael'), to: at('osgo'), damageType: 'slashing' }); setTimeout(() => table.effect({ kind: 'impact', at: at('osgo'), damageType: 'slashing', crit: true }), 0); }
  else if (e.key === 'w') {
    wi = (wi + 1) % KINDS.length; scene.weather = { kind: KINDS[wi], intensity: 0.7, wind: 0.4 };
    table.setState(state()); console.log('clima', KINDS[wi]);
  } else if (e.key === 'f') table.floatText('trasgo-b', '−9', '#8FD3F5');
});
