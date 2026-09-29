import type { Room, RemoteParticipant } from 'livekit-client';
import { net } from '../net';

type Mem = { id: string; name: string; role: string; online: boolean };
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; an?: AnalyserNode; vol: number; queue: RTCIceCandidateInit[] };
type Sig = { type: 'hello' | 'offer' | 'answer' | 'ice' | 'bye'; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

// Con state.livekit la voz va por un SFU LiveKit (livekit-client, import dinámico); sin él, malla WebRTC.
// ponytail: malla completa (n*(n-1)/2 conexiones), vale hasta ~6 personas. Con más, SFU tipo LiveKit en una fase posterior.
// ponytail: solo STUN, sin TURN; tras NAT simétrico algunos pares no conectarán. Añadir TURN si hay quejas.
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const THRESH = 0.02, HANG = 300;
const talking = new Set<string>();
export const speaking = (): Set<string> => talking;

const rms = (an: AnalyserNode, buf: Uint8Array<ArrayBuffer>) => {
  an.getByteTimeDomainData(buf);
  let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
  return Math.sqrt(s / buf.length);
};
const store = (k: string, v?: string) => { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };

export function mountVoice(el: HTMLElement, opts: { me: string; members: () => Mem[]; getVolume?: () => number; livekit?: () => boolean }): { destroy(): void; onState(members: Mem[]): void } {
  const { me } = opts;
  let mems = opts.members();
  let stream: MediaStream | undefined, ctx: AudioContext | undefined, meAn: AnalyserNode | undefined, probe: MediaStream | undefined;
  let joined = false, muted = false, ptt = false, vadOn = false, vadLast = 0;
  let mode: 'ptt' | 'vad' = store('lantern:voice:mode') === 'vad' ? 'vad' : 'ptt';
  let key = store('lantern:voice:key') ?? 'v';
  let capturing = false;
  const peers = new Map<string, Peer>();
  let lk: Room | undefined;
  const lkVol = new Map<string, number>(); // volumen por participante remoto en modo SFU
  const buf = new Uint8Array(new ArrayBuffer(512));

  el.innerHTML = `<section class="voz" aria-labelledby="voz-h"><h3 id="voz-h">Voz</h3>
    <p class="voz-st" role="status" aria-live="polite"></p>
    <div class="voz-bar"><button type="button" class="voz-join"></button><button type="button" class="voz-mute" aria-pressed="false" hidden>Silenciar</button></div>
    <div class="voz-modo seg" role="radiogroup" aria-label="Modo de micrófono">
      <button type="button" role="radio" data-m="ptt">Pulsar para hablar</button><button type="button" role="radio" data-m="vad">Detectar voz</button></div>
    <p class="voz-key det"><button type="button" class="voz-cfg"></button></p>
    <ul class="voz-list" aria-label="Participantes en voz"></ul></section>`;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const st = $('.voz-st'), joinB = $<HTMLButtonElement>('.voz-join'), muteB = $<HTMLButtonElement>('.voz-mute'), list = $('.voz-list'), cfg = $<HTMLButtonElement>('.voz-cfg');
  const say = (t: string) => { st.textContent = t; };
  const nameOf = (id: string) => mems.find(m => m.id === id)?.name ?? 'Jugador';

  const lkGain = (id: string) => { (lk?.remoteParticipants.get(id) as RemoteParticipant | undefined)?.setVolume(Math.min(1, (lkVol.get(id) ?? 1) * (opts.getVolume?.() ?? 1))); };
  const gain = (p: Peer) => { p.audio.volume = Math.min(1, p.vol * (opts.getVolume?.() ?? 1)); };
  const gate = () => {
    const on = joined && !muted && (mode === 'ptt' ? ptt : vadOn);
    stream?.getAudioTracks().forEach(t => { t.enabled = on; });
    return on;
  };

  function paint() {
    joinB.textContent = joined ? 'Salir de la voz' : 'Unirse a la voz';
    muteB.hidden = !joined; muteB.setAttribute('aria-pressed', String(muted));
    muteB.textContent = muted ? 'Activar micrófono' : 'Silenciar';
    el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.m === mode)));
    $('.voz-key').hidden = mode !== 'ptt';
    cfg.textContent = capturing ? 'Pulsa la nueva tecla…' : `Tecla para hablar: ${key.toUpperCase()} (cambiar)`;
    list.replaceChildren();
    const row = (id: string, name: string, p?: { vol: number }) => {
      const li = document.createElement('li'); li.dataset.id = id;
      li.innerHTML = '<span class="voz-ring" aria-hidden="true"></span><span class="voz-n"></span><span class="voz-s"></span>';
      li.querySelector('.voz-n')!.textContent = name;
      if (p) {
        const r = document.createElement('input'); r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.05'; r.value = String(p.vol);
        r.setAttribute('aria-label', `Volumen de ${name}`);
        r.oninput = () => { p.vol = +r.value; if ('audio' in p) gain(p as Peer); else { lkVol.set(id, p.vol); lkGain(id); } };
        li.append(r);
      }
      list.append(li);
    };
    if (joined) row(me, 'Tú');
    peers.forEach((p, id) => row(id, nameOf(id), p));
    lk?.remoteParticipants.forEach((_, id) => { if (!lkVol.has(id)) lkVol.set(id, 1); row(id, nameOf(id), { get vol() { return lkVol.get(id)!; }, set vol(v) { lkVol.set(id, v); } }); });
  }

  const send = (to: string, data: Sig) => net.send({ t: 'rtc', to, data });
  function drop(id: string, notify = false) {
    const p = peers.get(id); if (!p) return;
    if (notify) send(id, { type: 'bye' });
    p.pc.close(); p.audio.srcObject = null; p.audio.remove(); peers.delete(id); talking.delete(id);
  }

  function connect(id: string): Peer {
    drop(id);
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio(); audio.autoplay = true;
    const p: Peer = { pc, audio, vol: 1, queue: [] };
    peers.set(id, p);
    stream!.getAudioTracks().forEach(t => pc.addTrack(t, stream!));
    pc.onicecandidate = e => { if (e.candidate) send(id, { type: 'ice', ice: e.candidate.toJSON() }); };
    pc.ontrack = e => {
      audio.srcObject = e.streams[0]; gain(p);
      p.an = ctx!.createAnalyser(); p.an.fftSize = 512;
      ctx!.createMediaStreamSource(e.streams[0]).connect(p.an); // solo análisis; la salida va por <audio>
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { say(`No se pudo conectar la voz con ${nameOf(id)}.`); drop(id); paint(); }
    };
    paint();
    return p;
  }

  async function offer(id: string) {
    const p = connect(id);
    await p.pc.setLocalDescription(await p.pc.createOffer());
    send(id, { type: 'offer', sdp: p.pc.localDescription!.toJSON() });
  }

  const off = net.on(async m => {
    if (m.t !== 'rtc' || !joined || lk) return;
    const d = m.data as Sig, from = m.from;
    try {
      if (d.type === 'hello') { if (me > from) await offer(from); else send(from, { type: 'hello' }); }
      else if (d.type === 'offer' && d.sdp) {
        const p = connect(from);
        await p.pc.setRemoteDescription(d.sdp);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        send(from, { type: 'answer', sdp: p.pc.localDescription!.toJSON() });
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c);
      } else if (d.type === 'answer' && d.sdp) {
        const p = peers.get(from); if (!p) return;
        await p.pc.setRemoteDescription(d.sdp);
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c);
      } else if (d.type === 'ice' && d.ice) {
        const p = peers.get(from); if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice); else p.queue.push(d.ice);
      } else if (d.type === 'bye') { drop(from); paint(); }
    } catch { say(`Error de conexión de voz con ${nameOf(from)}.`); }
  });

  async function join() {
    joinB.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      say(denied ? 'No hay permiso para usar el micrófono. Actívalo en los ajustes del navegador y vuelve a intentarlo.'
        : 'No se encontró ningún micrófono disponible.');
      joinB.disabled = false; return;
    }
    ctx = new AudioContext();
    probe = stream.clone(); // la pista enviada se desactiva al callar; el análisis usa una copia siempre activa
    meAn = ctx.createAnalyser(); meAn.fftSize = 512;
    ctx.createMediaStreamSource(probe).connect(meAn);
    joined = true; joinB.disabled = false; gate();
    say(mode === 'ptt' ? `Conectado a la voz. Mantén ${key.toUpperCase()} para hablar.` : 'Conectado a la voz. Detección de voz activa.');
    if (opts.livekit?.()) { if (!await joinSfu()) { const t = st.textContent!; leave(); say(t); return; } }
    else mems.filter(m => m.online && m.id !== me && m.role !== 'spectator').forEach(m => send(m.id, { type: 'hello' }));
    paint();
  }

  // SFU: pide token al servidor, conecta y publica la pista del micro (gate() la activa/desactiva como en la malla).
  async function joinSfu(): Promise<boolean> {
    try {
      const got = new Promise<{ url: string; token: string }>((ok, ko) => {
        const o = net.on(m => { if (m.t === 'livekit') { o(); ok(m); } else if (m.t === 'error') { o(); ko(new Error(m.msg)); } });
        setTimeout(() => { o(); ko(new Error('sin respuesta')); }, 8000);
      });
      net.send({ t: 'livekit' });
      const { url, token } = await got;
      const { Room, RoomEvent, Track } = await import('livekit-client');
      const room = new Room();
      room.on(RoomEvent.TrackSubscribed, (t) => { if (t.kind === Track.Kind.Audio) document.body.append(t.attach()); });
      room.on(RoomEvent.TrackUnsubscribed, (t) => t.detach().forEach(e => e.remove()));
      room.on(RoomEvent.ParticipantConnected, () => paint());
      room.on(RoomEvent.ParticipantDisconnected, (p) => { talking.delete(p.identity); lkVol.delete(p.identity); paint(); });
      room.on(RoomEvent.Disconnected, () => { if (lk === room) { say('Se perdió la conexión de voz.'); leave(); } });
      await room.connect(url, token);
      lk = room;
      if (mems.find(m => m.id === me)?.role !== 'spectator') await room.localParticipant.publishTrack(stream!.getAudioTracks()[0], { source: Track.Source.Microphone });
      return true;
    } catch (e) { say(`No se pudo conectar a la voz: ${e instanceof Error ? e.message : 'error'}`); return false; }
  }

  function leave() {
    [...peers.keys()].forEach(id => drop(id, true));
    const r = lk; lk = undefined; void r?.disconnect(); lkVol.clear();
    stream?.getTracks().forEach(t => t.stop()); probe?.getTracks().forEach(t => t.stop());
    void ctx?.close();
    stream = probe = ctx = meAn = undefined; joined = false; ptt = vadOn = false; talking.delete(me);
    say('Has salido de la voz.'); paint();
  }

  joinB.onclick = () => (joined ? leave() : void join());
  muteB.onclick = () => { muted = !muted; gate(); say(muted ? 'Micrófono silenciado.' : 'Micrófono activado.'); paint(); };
  el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => {
    mode = b.dataset.m as 'ptt' | 'vad'; store('lantern:voice:mode', mode); ptt = vadOn = false; gate(); paint();
  });
  cfg.onclick = () => { capturing = true; paint(); };

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const kd = (e: KeyboardEvent) => {
    if (capturing) {
      e.preventDefault();
      if (e.key !== 'Escape' && e.key.length === 1) { key = e.key.toLowerCase(); store('lantern:voice:key', key); }
      capturing = false; paint(); cfg.focus(); return;
    }
    if (typing(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== key) return;
    ptt = true; gate();
  };
  const ku = (e: KeyboardEvent) => { if (e.key.toLowerCase() === key && ptt) { ptt = false; gate(); } };
  const blur = () => { ptt = false; gate(); };
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', blur);

  const tick = setInterval(() => {
    const now = performance.now();
    if (joined && meAn && mode === 'vad') {
      if (rms(meAn, buf) > THRESH) { vadLast = now; vadOn = true; } else if (vadOn && now - vadLast > HANG) vadOn = false; // histéresis 300 ms
      gate();
    }
    if (meAn) { const on = gate() && rms(meAn, buf) > THRESH; on ? talking.add(me) : talking.delete(me); }
    lk?.remoteParticipants.forEach((p, id) => { p.isSpeaking ? talking.add(id) : talking.delete(id); lkGain(id); });
    peers.forEach((p, id) => { (p.an && rms(p.an, buf) > THRESH) ? talking.add(id) : talking.delete(id); gain(p); });
    list.querySelectorAll<HTMLElement>('li').forEach(li => {
      const on = talking.has(li.dataset.id!);
      li.classList.toggle('habla', on);
      li.querySelector('.voz-s')!.textContent = on ? 'hablando' : '';
    });
  }, 80);

  paint();
  return {
    destroy() {
      if (joined) leave();
      off(); clearInterval(tick);
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', blur);
      el.replaceChildren();
    },
    onState(members) {
      mems = members;
      let ch = false;
      for (const id of [...peers.keys()]) {
        const m = members.find(x => x.id === id);
        if (!m || !m.online) { drop(id); ch = true; }
      }
      if (ch || joined) paint();
    },
  };
}
