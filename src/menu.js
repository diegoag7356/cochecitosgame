// ============================================================
// Menús, configuración y persistencia (cookies del navegador)
// Paleta EXACTA: Rojo, Azul, Verde, Amarillo, Rosa, Morado,
// Naranja y Blanco — los bots toman los 7 que no eliges.
// Nombres inventados (sin marcas de competiciones reales).
// ============================================================

export const CAR_COLORS = [
  { name: 'Rojo',    hex: '#e10600' },
  { name: 'Azul',    hex: '#0066ff' },
  { name: 'Verde',   hex: '#00b85c' },
  { name: 'Amarillo',hex: '#ffd400' },
  { name: 'Rosa',    hex: '#ff4fa3' },
  { name: 'Morado',  hex: '#9b30ff' },
  { name: 'Naranja', hex: '#ff7b00' },
  { name: 'Blanco',  hex: '#f2f2f2' },
];

// ---- Cookies (el usuario pidió guardar en cookies del navegador) ----
export function setCookie(name, value) {
  document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax';
}
export function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).classList.toggle('open', !!on); };

// ---- Multijugador (Firebase Realtime Database) ----
let MP = null;
export function setMultiplayer(mp) { MP = mp; }
function onlyScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('open');
  if (id) show(id, true);
}

// Construye una fila de swatches de color
function buildSwatches(container, colors, initial, onPick) {
  container.innerHTML = '';
  let sel = initial;
  colors.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'swatch' + (c.hex === sel ? ' sel' : '');
    d.style.background = c.hex;
    d.title = c.name;
    d.addEventListener('click', () => {
      sel = c.hex;
      container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
      d.classList.add('sel');
      onPick(c.hex);
    });
    container.appendChild(d);
  });
  return () => sel;
}

// Estado del lobby MP: color elegido pendiente de confirmar
let mpColorSel = null;

// ============================================================
export function initMenus(game) {
  const cookieName = () => getCookie('f1_name') || 'PILOTO';
  const cookieColor = () => {
    const c = getCookie('f1_color');
    return CAR_COLORS.some((k) => k.hex === c) ? c : CAR_COLORS[0].hex;
  };

  // Estado configurable
  const tt = { name: cookieName(), color: cookieColor(), laps: 5 };
  const race = { name: cookieName(), color: cookieColor(), difficulty: 'medium', laps: 5 };

  // --- Navegación básica ---
  $('btn-play').addEventListener('click', () => onlyScreen('screen-modes'));
  $('btn-back-home').addEventListener('click', () => onlyScreen('screen-home'));
  $('btn-tt-back').addEventListener('click', () => onlyScreen('screen-modes'));
  $('btn-race-back').addEventListener('click', () => onlyScreen('screen-modes'));

  // ---- Multijugador ----
  const mp = { name: cookieName(), laps: 5, size: 8 };
  $('btn-mp').addEventListener('click', () => {
    $('mp-name').value = mp.name;
    $('mp-join-name').value = mp.name;
    onlyScreen('screen-mp');
  });
  $('btn-mp-back').addEventListener('click', () => onlyScreen('screen-modes'));
  $('mp-minus').addEventListener('click', () => { mp.laps = Math.max(3, mp.laps - 1); $('mp-laps').textContent = mp.laps; });
  $('mp-plus').addEventListener('click', () => { mp.laps = Math.min(20, mp.laps + 1); $('mp-laps').textContent = mp.laps; });
  $('mp-size-minus').addEventListener('click', () => { mp.size = Math.max(2, mp.size - 1); $('mp-size').textContent = mp.size; });
  $('mp-size-plus').addEventListener('click', () => { mp.size = Math.min(8, mp.size + 1); $('mp-size').textContent = mp.size; });
  const mpName = (inputId) => {
    const v = $(inputId).value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12);
    $(inputId).value = v;
    return v;
  };
  $('mp-name').addEventListener('input', () => { mp.name = mpName('mp-name'); setCookie('f1_name', mp.name); });
  $('mp-join-name').addEventListener('input', () => { mp.name = mpName('mp-join-name'); setCookie('f1_name', mp.name); });
  $('mp-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });
  $('btn-mp-create').addEventListener('click', async () => {
    const name = mpName('mp-name');
    if (!name) { $('mp-name').focus(); return; }
    $('btn-mp-create').textContent = 'CREANDO…';
    try {
      if (!MP) throw new Error('no-mp');
      const code = await MP.createRoom({ name, laps: mp.laps, roomSize: mp.size });
      $('mp-room-code').textContent = code;
      onlyScreen('screen-mp-room');
    } catch (err) {
      alert('No se pudo crear la sala: ' + (err.message || err));
    }
    $('btn-mp-create').textContent = 'CREAR SALA';
  });
  $('btn-mp-join').addEventListener('click', async () => {
    const name = mpName('mp-join-name');
    const code = $('mp-code').value.trim();
    if (!name) { $('mp-join-name').focus(); return; } // sin nombre NO puedes poner código
    if (!code) { $('mp-code').focus(); return; }
    $('btn-mp-join').textContent = 'UNIÉNDOTE…';
    try {
      if (!MP) throw new Error('no-mp');
      await MP.join(code, name);
      $('mp-room-code').textContent = code;
      onlyScreen('screen-mp-room');
    } catch (err) {
      alert('No se pudo unir: ' + (err.message || err));
    }
    $('btn-mp-join').textContent = 'UNIRSE';
  });
  $('btn-mp-leave').addEventListener('click', async () => {
    if (MP) await MP.leaveRoom();
    onlyScreen('screen-mp');
  });
  $('btn-mp-begin').addEventListener('click', () => MP && MP.startPicking());
  $('btn-mp-launch').addEventListener('click', () => MP && MP.startRecon());
  $('btn-mp-ready').addEventListener('click', () => {
    if (MP) MP.setReady(!MP.me()?.ready);
  });
  // CONFIRMAR COLOR: solo pasa el turno cuando el jugador lo decide
  $('btn-mp-confirm').addEventListener('click', async () => {
    if (!MP || !MP.myTurn() || !mpColorSel) return;
    $('btn-mp-confirm').textContent = 'CONFIRMANDO…';
    const ok = await MP.pickColor(mpColorSel);
    if (!ok) $('btn-mp-confirm').textContent = 'OCUPADO · ELIGE OTRO';
    else $('btn-mp-confirm').textContent = '¡COLOR CONFIRMADO!';
  });

  // --- Free play: sin semáforo, sin cronometraje oficial ---
  $('btn-free').addEventListener('click', () => {
    game.startSession({ mode: 'free', playerName: cookieName(), playerColor: cookieColor() });
  });

  // --- Cronometraje ---
  $('btn-timetrial').addEventListener('click', () => {
    $('tt-name').value = tt.name;
    buildSwatches($('tt-colors'), CAR_COLORS, tt.color, (hex) => { tt.color = hex; setCookie('f1_color', hex); });
    onlyScreen('screen-tt');
  });
  $('tt-minus').addEventListener('click', () => { tt.laps = Math.max(5, tt.laps - 1); $('tt-laps').textContent = tt.laps; });
  $('tt-plus').addEventListener('click', () => { tt.laps = Math.min(10, tt.laps + 1); $('tt-laps').textContent = tt.laps; });
  $('tt-name').addEventListener('input', (e) => {
    tt.name = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12);
    e.target.value = tt.name;
    setCookie('f1_name', tt.name);
  });
  $('btn-tt-start').addEventListener('click', () => {
    if (!tt.name.trim()) { $('tt-name').focus(); return; }
    setCookie('f1_name', tt.name);
    game.startSession({ mode: 'timetrial', playerName: tt.name.trim(), playerColor: tt.color, laps: tt.laps });
  });

  // --- Carrera (IA) ---
  $('btn-race').addEventListener('click', () => {
    race.name = cookieName();
    $('race-name').value = race.name;
    buildSwatches($('race-colors'), CAR_COLORS, race.color, (hex) => { race.color = hex; setCookie('f1_color', hex); });
    document.querySelectorAll('.diff-btn').forEach((b) => {
      b.style.borderColor = b.dataset.d === race.difficulty ? '#fff' : 'rgba(255,255,255,.16)';
      b.style.opacity = b.dataset.d === race.difficulty ? '1' : '.55';
      b.onclick = () => {
        race.difficulty = b.dataset.d;
        document.querySelectorAll('.diff-btn').forEach((x) => {
          x.style.borderColor = x.dataset.d === race.difficulty ? '#fff' : 'rgba(255,255,255,.16)';
          x.style.opacity = x.dataset.d === race.difficulty ? '1' : '.55';
        });
      };
    });
    $('race-laps').textContent = race.laps;
    onlyScreen('screen-race');
  });
  $('race-minus').addEventListener('click', () => { race.laps = Math.max(3, race.laps - 1); $('race-laps').textContent = race.laps; });
  $('race-plus').addEventListener('click', () => { race.laps = Math.min(20, race.laps + 1); $('race-laps').textContent = race.laps; });
  $('race-name').addEventListener('input', (e) => {
    race.name = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12);
    e.target.value = race.name;
    setCookie('f1_name', race.name);
  });
  $('btn-race-start').addEventListener('click', () => {
    if (!race.name.trim()) { $('race-name').focus(); return; }
    setCookie('f1_name', race.name);
    game.startSession({
      mode: 'race', playerName: race.name.trim(), playerColor: race.color,
      difficulty: race.difficulty, laps: race.laps,
    });
  });

  // --- Online (NPC): carrera "online" de práctica con rivales NPC nivelados ---
  const online = { name: cookieName(), color: cookieColor(), laps: 5 };
  $('btn-online').addEventListener('click', () => {
    online.name = cookieName();
    $('online-name').value = online.name;
    buildSwatches($('online-colors'), CAR_COLORS, online.color, (hex) => { online.color = hex; setCookie('f1_color', hex); });
    $('online-laps').textContent = online.laps;
    onlyScreen('screen-online');
  });
  $('btn-online-back').addEventListener('click', () => onlyScreen('screen-modes'));
  $('online-minus').addEventListener('click', () => { online.laps = Math.max(3, online.laps - 1); $('online-laps').textContent = online.laps; });
  $('online-plus').addEventListener('click', () => { online.laps = Math.min(20, online.laps + 1); $('online-laps').textContent = online.laps; });
  $('online-name').addEventListener('input', (e) => {
    online.name = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12);
    e.target.value = online.name;
    setCookie('f1_name', online.name);
  });
  $('btn-online-start').addEventListener('click', () => {
    if (!online.name.trim()) { $('online-name').focus(); return; }
    setCookie('f1_name', online.name);
    game.startSession({
      mode: 'online', playerName: online.name.trim(), playerColor: online.color, laps: online.laps,
    });
  });

  // --- Ajustes de pausa (volumen + sensibilidad) ---
  const opts = {
    volume: parseFloat(getCookie('f1_volume') || '0.7'),
    sens: parseFloat(getCookie('f1_sens') || '1'),
  };
  const vol = $('opt-volume'), sens = $('opt-sens');
  if (vol) {
    vol.value = Math.round(opts.volume * 100);
    $('opt-vol-val').textContent = Math.round(opts.volume * 100);
    vol.addEventListener('input', () => {
      opts.volume = vol.value / 100;
      $('opt-vol-val').textContent = vol.value;
      setCookie('f1_volume', String(opts.volume));
      game.setVolume(opts.volume);
    });
  }
  if (sens) {
    sens.value = Math.round(opts.sens * 100);
    $('opt-sens-val').textContent = opts.sens.toFixed(1);
    sens.addEventListener('input', () => {
      opts.sens = sens.value / 100;
      $('opt-sens-val').textContent = opts.sens.toFixed(1);
      setCookie('f1_sens', String(opts.sens));
      game.setSteerSens(opts.sens);
    });
  }
  // Aplicar ajustes guardados al arrancar
  if (opts.volume !== 0.7) game.setVolume(opts.volume);
  if (opts.sens !== 1) game.setSteerSens(opts.sens);

  // --- Semáforo: 5 luces en fila horizontal (1 bombilla por columna) ---
  const gantry = $('lights-gantry');
  gantry.innerHTML = '';
  for (let c = 0; c < 5; c++) {
    const col = document.createElement('div');
    col.className = 'light-col';
    const b = document.createElement('div');
    b.className = 'bulb';
    b.dataset.col = c;
    col.appendChild(b);
    gantry.appendChild(col);
  }

  // --- Pausa ---
  $('btn-resume').addEventListener('click', () => game.resume());
  $('btn-restart').addEventListener('click', () => game.restartSession());
  $('btn-to-menu').addEventListener('click', () => game.quitToMenu());

  // --- Resultados ---
  $('btn-again').addEventListener('click', () => game.restartSession());
  $('btn-res-menu').addEventListener('click', () => game.quitToMenu());
}

  // ---- Render de la sala en vivo (se llama desde el callback de mp.js) ----
  let lastPlayersHTML = '';
  window.__renderMpRoom = (room) => {
    if (!room || !$('screen-mp-room').classList.contains('open')) return;
    const ps = MP.playersSorted();
    const meta = room.meta || {};
    // Estado de la sala
    const statusTxt = {
      lobby: 'ESPERANDO JUGADORES (' + ps.length + '/' + (meta.roomSize || 8) + ')',
      picking: 'ELIGIENDO COLORES POR ORDEN DE UNIÓN',
      'picking-done': 'ESPERANDO A QUE TODOS ESTÉN LISTOS',
      recon: 'VUELTA DE RECONOCIMIENTO',
      grid: 'FORMANDO PARRILLA…',
      racing: '¡CARRERA!',
      finished: 'CARRERA TERMINADA',
    }[meta.status] || meta.status;
    $('mp-room-status').textContent = statusTxt;
    // Jugadores
    let html = '';
    for (const p of ps) {
      const isTurn = meta.status === 'picking' && meta.pickingTurn === ps.indexOf(p);
      html += '<div class="b-row" style="font-size:14px; padding:6px 10px;">'
        + '<span class="b-tape" style="background:' + p.color + '"></span>'
        + '<span class="b-name">' + p.name + (p.id === 'p' ? '' : '') + (isTurn ? ' ← ELIGE' : '') + '</span>'
        + '<span class="b-gap">' + (p.ready ? 'LISTO ✓' : '') + '</span></div>';
    }
    if (html !== lastPlayersHTML) { lastPlayersHTML = html; $('mp-players').innerHTML = html; }
    // Turno de color: elegir + CONFIRMAR (el turno solo pasa al confirmar)
    const me = MP.me();
    const myTurn = MP.myTurn();
    $('mp-turn-box').style.display = myTurn ? '' : 'none';
    if (myTurn && !$('mp-colors').hasChildNodes()) {
      mpColorSel = null;
      $('btn-mp-confirm').textContent = 'CONFIRMAR COLOR';
      buildSwatches($('mp-colors'), CAR_COLORS, me?.color, (hex) => { mpColorSel = hex; $('btn-mp-confirm').textContent = 'CONFIRMAR ' + (CAR_COLORS.find((c) => c.hex === hex)?.name || 'COLOR').toUpperCase(); });
    }
    // Host tools
    $('mp-host-tools').style.display = MP.isHost && (meta.status === 'lobby') ? '' : 'none';
    $('btn-mp-launch').style.display = MP.isHost && meta.status === 'picking-done' && MP.allReady() ? '' : 'none';
    // Botón LISTO: solo cuando TODOS los colores están elegidos
    const pickingDone = meta.status === 'picking-done';
    $('btn-mp-ready').style.display = pickingDone ? '' : 'none';
    $('mp-ready-hint').style.display = pickingDone ? '' : 'none';
    if (me) $('btn-mp-ready').textContent = me.ready ? 'LISTO ✓ (PULSA PARA QUITARLO)' : 'LISTO';
    // Cuando el host lanza la vuelta de reconocimiento, main.js toma el control
    if (meta.status === 'recon' && window.__mpStartRecon) window.__mpStartRecon(room);
    // AUTO-LANZAMIENTO: si todos están listos, el host arranca solo (1.2 s)
    // — nada de salas atascadas esperando un botón.
    if (MP.isHost && pickingDone && MP.allReady()) {
      if (!window.__mpAutoT) window.__mpAutoT = setTimeout(() => { window.__mpAutoT = null; if (MP.room?.meta?.status === 'picking-done') MP.startRecon(); }, 1200);
    } else if (window.__mpAutoT) { clearTimeout(window.__mpAutoT); window.__mpAutoT = null; }
  };

// Utilidades para que main.js gestione pantallas de estado
export const screens = {
  only: onlyScreen,
  show,
  home: () => onlyScreen('screen-home'),
  pause: (on) => show('pause-screen', on),
  results: (on) => show('results-screen', on),
  lights: (on) => show('lights-screen', on),
};
