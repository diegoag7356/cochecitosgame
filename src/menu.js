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

// Utilidades para que main.js gestione pantallas de estado
export const screens = {
  only: onlyScreen,
  show,
  home: () => onlyScreen('screen-home'),
  pause: (on) => show('pause-screen', on),
  results: (on) => show('results-screen', on),
  lights: (on) => show('lights-screen', on),
};
