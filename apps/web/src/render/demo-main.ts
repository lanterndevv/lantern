// Demo del renderer: /render-demo.html (?dm=1 = vista DM sin niebla)
import { demoScene } from '@lantern/protocol/demo';
import type { ClientState, Point } from '@lantern/protocol';
import { sightSegments, visibility } from '@lantern/vision';
import { createTable } from './table.ts';

const dm = new URLSearchParams(location.search).get('dm') === '1';
const scene = demoScene();
scene.tokens.find((t) => t.id === 'kael')!.owners = ['yo'];
document.body.style.cssText = 'margin:0;overflow:hidden;background:#070504';

// ponytail: visión en el cliente solo para la demo (en producción la calcula el servidor)
const vis = (): Point[][] =>
  scene.tokens.filter((t) => t.faction === 'ally').map((t) => visibility(t, sightSegments(scene.walls), scene.width, scene.height));
const state = (): ClientState => ({
  code: 'DEMO', members: [{ id: 'yo', name: 'Yo', role: dm ? 'dm' : 'player', online: true }],
  scene: structuredClone(scene), visible: dm ? undefined : vis(),
});

const table = await createTable(document.body, {
  role: dm ? 'dm' : 'player', memberId: 'yo',
  onMoveToken(id, x, y) {
    console.log('move', id, x, y);
    const t = scene.tokens.find((t) => t.id === id)!; t.x = x; t.y = y;
    table.setState(state());
  },
  onPing(x, y) { console.log('ping', x, y); table.ping(x, y, '#E8A33D'); },
  onDoor(id, open) {
    console.log('door', id, open);
    scene.walls.find((w) => w.id === id)!.open = open;
    table.setState(state());
  },
});
table.setState(state());
