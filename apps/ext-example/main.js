import { connect } from './sdk.js';

const TABLA = ['12 po y una daga oxidada', '3 pp y una poción de curación menor', 'un mapa mordisqueado', '7 po y un anillo de latón', 'nada, salvo mala suerte', '25 pc y una cuerda de seda'];
const el = document.getElementById('estado');

try {
  const lantern = await connect({ apiVersion: 1 });
  await lantern.contextMenu.add({ id: 'botin', label: 'Registrar botín' });
  lantern.contextMenu.onClick(async (tokenId, itemId) => {
    if (itemId !== 'botin') return;
    const s = await lantern.state.get();
    const nombre = s.tokens.find(t => t.id === tokenId)?.name ?? 'El token';
    const botin = TABLA[Math.floor(Math.random() * TABLA.length)];
    await lantern.chat.send(`${nombre} llevaba: ${botin}`);
  });
  el.textContent = 'Listo: pulsa un token y elige «Registrar botín».';
  lantern.panel.setHeight(60);
} catch (e) { el.textContent = String(e.message ?? e); }
