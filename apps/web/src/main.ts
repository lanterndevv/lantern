import './styles.css';
import type { S2C } from '@lantern/protocol';
import { net, savedKey, savedName, saveKey } from './net.ts';
import { mountJoin } from './ui/join.ts';
import { mountTable } from './ui/table.ts';
import { displayModeFromUrl } from './ui/display.ts';
import './ui/a11y.ts'; // aplica las preferencias de accesibilidad al cargar
import { t } from './i18n.ts';

document.title = t('Lantern · Mesa de D&D');

const app = document.getElementById('app')!;
let screen: { handle(m: S2C): void } = mountJoin(app);

net.on(m => {
  if (m.t === 'welcome' && !app.querySelector('.mesa')) {
    app.replaceChildren();
    screen = mountTable(app, m);
  }
  screen.handle(m);
});

const code = new URLSearchParams(location.search).get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Enlace del instalador (?code=X#k=KEY): la key es la del DM de esa mesa; se guarda, se borra del fragmento y se entra.
const hashKey = /[#&]k=([^&]+)/.exec(location.hash)?.[1];
if (code && hashKey) {
  try { saveKey(code, decodeURIComponent(hashKey)); } catch { /* sin almacenamiento o key mal codificada */ }
  history.replaceState(null, '', location.pathname + location.search);
}
// Entrada directa si ya hay key guardada para ?code=
if (code && savedKey(code) && (savedName() || hashKey) && displayModeFromUrl() === 'normal') net.send({ t: 'join', code, name: savedName() || 'DM', key: savedKey(code)! });

// ?vista=mesa|espectador: entra solo como espectador, sin formulario.
const vista = displayModeFromUrl();
if (vista !== 'normal' && code) net.send({ t: 'join', code, name: vista === 'mesa' ? t('Mesa') : t('Espectador'), as: 'spectator', key: savedKey(code, 'spectator') ?? undefined });

// PWA: solo en producción
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
