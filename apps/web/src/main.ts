import './styles.css';
import type { S2C } from '@lantern/protocol';
import { net, savedKey, savedName } from './net.ts';
import { mountJoin } from './ui/join.ts';
import { mountTable } from './ui/table.ts';
import { displayModeFromUrl } from './ui/display.ts';
import './ui/a11y.ts'; // aplica las preferencias de accesibilidad al cargar

const app = document.getElementById('app')!;
let screen: { handle(m: S2C): void } = mountJoin(app);

net.on(m => {
  if (m.t === 'welcome' && !app.querySelector('.mesa')) {
    app.replaceChildren();
    screen = mountTable(app, m);
  }
  screen.handle(m);
});

// Entrada directa si ya hay key guardada para ?code=
const code = new URLSearchParams(location.search).get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '');
if (code && savedKey(code) && savedName() && displayModeFromUrl() === 'normal') net.send({ t: 'join', code, name: savedName(), key: savedKey(code)! });

// ?vista=mesa|espectador: entra solo como espectador, sin formulario.
const vista = displayModeFromUrl();
if (vista !== 'normal' && code) net.send({ t: 'join', code, name: vista === 'mesa' ? 'Mesa' : 'Espectador', as: 'spectator', key: savedKey(code, 'spectator') ?? undefined });

// PWA: solo en producción
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
