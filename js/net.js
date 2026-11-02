// Capa de red P2P sobre PeerJS (WebRTC). El servidor público de PeerJS solo
// se usa para la señalización inicial; los datos de juego van directos entre navegadores.
//
// Se abren dos DataChannels:
//   - "ctrl"  : fiable y ordenado (saludo, golpes, revancha, ping)
//   - "state" : no ordenado (instantáneas de estado ~60 Hz, sin bloqueos por pérdidas)

const PREFIX = 'wabo-pingpong-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I/L)

const PEER_OPTS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

// Solo en desarrollo: ?signal=localhost:9000 usa un PeerServer local (npx peer --port 9000).
(() => {
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const sig = new URLSearchParams(location.search).get('signal');
  if (isLocal && sig) {
    const [host, port] = sig.split(':');
    Object.assign(PEER_OPTS, { host, port: +port || 9000, path: '/', secure: false });
  }
})();

export function randomCode(len = 5) {
  let s = '';
  const arr = crypto.getRandomValues(new Uint32Array(len));
  for (let i = 0; i < len; i++) s += ALPHABET[arr[i] % ALPHABET.length];
  return s;
}

export function normalizeCode(raw) {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

const ERRORS = {
  'peer-unavailable': 'No existe ninguna sala con ese código (o el anfitrión la ha cerrado).',
  'unavailable-id': 'Ese código ya está en uso.',
  'full': 'Esa sala ya está llena: ya hay dos jugadores dentro.',
  'network': 'No se pudo contactar con el servidor de señalización. Revisa tu conexión.',
  'server-error': 'El servidor de señalización no responde. Inténtalo de nuevo en unos segundos.',
  'browser-incompatible': 'Tu navegador no soporta WebRTC.',
  'webrtc': 'Error de WebRTC al conectar con el rival.',
  'socket-error': 'Se perdió la conexión con el servidor de señalización.',
};
export const errorText = (err) => ERRORS[err?.type] || err?.message || 'Error de conexión desconocido.';

/** Envoltorio de sesión: misma interfaz para host e invitado. */
class Session {
  constructor() {
    this.peer = null;
    this.ctrl = null;
    this.state = null;
    this.handlers = {};
    this.closed = false;
  }
  on(evt, fn) { this.handlers[evt] = fn; return this; }
  emit(evt, ...a) { this.handlers[evt]?.(...a); }

  // El invitado solo está listo cuando el anfitrión le acepta explícitamente.
  get ready() { return !!(this.ctrl?.open && this.state?.open && (this.isHost || this.accepted)); }

  send(msg) { if (this.ctrl?.open) this.ctrl.send(msg); }
  sendState(msg) {
    if (this.state?.open) this.state.send(msg);
    else if (this.ctrl?.open) this.ctrl.send(msg);
  }

  _wire(conn) {
    conn.on('data', (m) => {
      if (!this.isHost && m?.t === 'accept') { this.accepted = true; this._checkReady(); return; }
      if (!this.isHost && m?.t === 'full') { clearTimeout(this._timeout); this.emit('error', { type: 'full' }); return; }
      this.emit('message', m);
    });
    conn.on('close', () => this._lost());
    conn.on('error', () => this._lost());
  }
  _checkReady() {
    if (this.ready && !this._readyFired) {
      this._readyFired = true;
      clearTimeout(this._timeout);
      this.emit('connected');
    }
  }
  _lost() {
    if (this.closed) return;
    if (this._readyFired) { this.closed = true; this.emit('disconnected'); }
  }

  destroy() {
    this.closed = true;
    try { this.ctrl?.close(); } catch {}
    try { this.state?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
  }
}

/** Crea una sala y espera a un rival. */
export function hostRoom(onCode) {
  const s = new Session();
  s.isHost = true;
  let attempts = 0;

  const open = () => {
    const code = randomCode();
    const peer = new Peer(PREFIX + code, PEER_OPTS);
    s.peer = peer;
    peer.on('open', () => { s.code = code; onCode(code); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempts++ < 5) { peer.destroy(); open(); return; }
      s.emit('error', err);
    });
    peer.on('disconnected', () => {
      // Perder la señalización no corta una partida ya establecida.
      if (!s._readyFired && !s.closed) peer.reconnect();
    });
    peer.on('connection', (conn) => {
      // Solo un rival por sala.
      const owner = s.ctrl?.peer || s.state?.peer;
      if (s._readyFired || (owner && conn.peer !== owner)) {
        conn.on('open', () => {
          if (conn.label === 'ctrl') conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 500);
        });
        return;
      }
      if (conn.label === 'state') s.state = conn; else s.ctrl = conn;
      s._wire(conn);
      conn.on('open', () => {
        if (conn.label === 'ctrl') conn.send({ t: 'accept' });
        s._checkReady();
      });
    });
  };
  open();
  return s;
}

/** Se une a una sala existente por código. */
export function joinRoom(code) {
  const s = new Session();
  s.isHost = false;
  s.code = code;
  const peer = new Peer(PEER_OPTS);
  s.peer = peer;
  peer.on('open', () => {
    const target = PREFIX + code;
    s.ctrl = peer.connect(target, { label: 'ctrl', reliable: true, serialization: 'json' });
    s.state = peer.connect(target, { label: 'state', reliable: false, serialization: 'json' });
    [s.ctrl, s.state].forEach((c) => { s._wire(c); c.on('open', () => s._checkReady()); });
    s._timeout = setTimeout(() => {
      if (!s._readyFired && !s.closed) s.emit('error', { type: 'timeout', message: 'No se pudo establecer la conexión directa con el rival (tiempo agotado). Puede que una red muy restrictiva lo esté bloqueando.' });
    }, 15000);
  });
  peer.on('error', (err) => { clearTimeout(s._timeout); if (!s._readyFired) s.emit('error', err); });
  return s;
}
