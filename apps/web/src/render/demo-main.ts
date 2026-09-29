// Demo del renderer: /render-demo.html (?dm=1 = vista DM sin niebla)
import { demoScene } from '@lantern/protocol/demo';
import type { ClientState, Point } from '@lantern/protocol';
import { sightSegments, visibility } from '@lantern/vision';
import type { Marks } from './api.ts';
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
  scene: structuredClone(scene), automation: 'assisted', visible: dm ? undefined : vis(),
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
addEventListener('keydown', (e) => {
  if (e.key === 'n') {
    const ids = scene.tokens.map((t) => t.id), i = ids.indexOf(marks.active ?? '');
    marks.active = ids[(i + 1) % ids.length]; table.setMarks(marks);
  } else if (e.key === 'f') table.floatText('trasgo-b', '−9', '#8FD3F5');
});
