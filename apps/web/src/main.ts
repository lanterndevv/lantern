import './styles.css';
import type { S2C } from '@lantern/protocol';
import { net, savedKey, savedName } from './net.ts';
import { mountJoin } from './ui/join.ts';
import { mountTable } from './ui/table.ts';

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
if (code && savedKey(code) && savedName()) net.send({ t: 'join', code, name: savedName(), key: savedKey(code)! });
