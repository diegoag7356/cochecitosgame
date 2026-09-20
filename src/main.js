import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Track } from './track.js';
import { MiniMap } from './minimap.js';
import { Race } from './race.js';
import { initMenus, screens } from './menu.js';
import { GameAudio } from './audio.js';

const OVERLAY = document.getElementById('overlay');
const HUD_SPEED = document.getElementById('hud-speed');
const HUD_GEAR = document.getElementById('hud-gear');
const HUD_BAR_T = document.getElementById('bar-throttle');
const HUD_BAR_B = document.getElementById('bar-brake');
const HUD_DRS = document.getElementById('drs-big');
const DRS_SUB = HUD_DRS.querySelector('.sub');
const HUD_MODE = document.getElementById('hud-mode');
const HUD_REV = document.getElementById('revbar-fill');
const HUD_CHIP = document.getElementById('drs-chip');
const HUD_CHIP_SUB = document.getElementById('drs-chip-sub');
const HUD_SURF = document.getElementById('surface-chip');
const HUD_TIME = document.getElementById('time-current');
const HUD_LAST = document.getElementById('time-last');
const HUD_BEST = document.getElementById('time-best');
const HUD_DRIVER = document.getElementById('hud-driver');
const HUD_LAPCOUNT = document.getElementById('hud-lapcount');
const RACE_STATE = document.getElementById('race-state');
const BOARD_ROWS = document.getElementById('board-rows');
const BLUE_FLAG = document.getElementById('blue-flag');
const SECTOR_FLASH = document.getElementById('sector-flash');
const SECTOR_NAME = document.getElementById('sector-name');
const SECTOR_TIME = document.getElementById('sector-time');
const HUD_DELTA = document.getElementById('time-delta');
const HUD_DMG = document.getElementById('dmg-chip');
const POS_BIG_P = document.getElementById('pos-big-p');
const POS_BIG_L = document.getElementById('pos-big-l');
const BOARD_MODE = document.getElementById('board-mode');
const SCALE = 0.02; // unidades obj -> mundo

let playing = false;
let paused = false;

// ---- Audio procedural (WebAudio, sin ficheros) ----
const AUDIO = new GameAudio();
window.addEventListener('pointerdown', () => AUDIO.start(), { once: true });

// ---- Ajustes (menú de pausa) y estado de inmersión ----
let steerSens = 1;      // multiplicador de velocidad de giro
let camShake = 0;       // sacudida de cámara por impactos
let playerDmg = 0;      // 0..1: pérdida temporal de punta/agarre
let resultsShown = false;
let lastFrac = 0;       // fracción de la marcha actual (para el motor de audio)

// ============================================================
// Renderer, escena, cámaras
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 250, 1500);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 2000);

// --- Cámara trasera (T-cam / retrovisor): banda superior, mira hacia atrás ---
const rearCanvas = document.getElementById('rearview');
const rearRenderer = new THREE.WebGLRenderer({ canvas: rearCanvas, antialias: true });
const rearCam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2000);
function sizeRearView() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(2, Math.round(window.innerWidth * dpr));
  const h = Math.max(2, Math.round(190 * dpr));
  rearRenderer.setSize(w, h, false);
  rearCam.aspect = window.innerWidth / 190;
  rearCam.updateProjectionMatrix();
}
sizeRearView();
function updateRearView() {
  const backX = Math.sin(drive.heading), backZ = Math.cos(drive.heading);
  rearCam.position.set(car.position.x + backX * 1.4, 1.15, car.position.z + backZ * 1.4);
  rearCam.up.set(0, 1, 0);
  rearCam.lookAt(car.position.x + backX * 40, 0.45, car.position.z + backZ * 40);
  rearRenderer.render(scene, rearCam);
}

// --- Luces ---
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3a7d2c, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// --- Pista + minimapa ---
const track = new Track(scene);
const minimap = new MiniMap(document.getElementById('minimap'), track, { size: 240 });

// ============================================================
// Coche (OBJ pintable: material dinámico para el color elegido)
// ============================================================
const car = new THREE.Group();
scene.add(car);

const brakeMat = new THREE.MeshStandardMaterial({
  color: 0x550000, emissive: 0xff1111, emissiveIntensity: 0.05, roughness: 0.4,
});
const brakeLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), brakeMat);
brakeLight.position.set(0, 0.22, 1.46);
car.add(brakeLight);

const flapMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
const drsFlap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.015, 0.2), flapMat);
drsFlap.position.set(0, 0.36, 1.4);
car.add(drsFlap);

const wheels = [];
let paintableMats = []; // materiales del cuerpo: se tiñen con el color del jugador
let playerBodyGeo = null; // carrocería procesada: se clona para los bots
let carReady = false;

const mtlLoader = new MTLLoader();
mtlLoader.setPath('coche formula (importado) naranja/');
mtlLoader.load('obj.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('coche formula (importado) naranja/tinker.obj', (object) => {
    const bodyGeoms = [];
    const darkGeoms = [];
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      const pos = g.getAttribute('position');
      if (!g.getAttribute('color')) {
        const matColor = child.material && child.material.color
          ? child.material.color
          : new THREE.Color(0xcc2222);
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          colors[i * 3] = matColor.r;
          colors[i * 3 + 1] = matColor.g;
          colors[i * 3 + 2] = matColor.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      g.deleteAttribute('uv');
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (child.name === 'group_0_2829873') darkGeoms.push(g);
      else bodyGeoms.push(g);
    });

    const orient = (geo) => {
      geo.rotateX(Math.PI / 2);
      geo.rotateZ(Math.PI);
      geo.computeBoundingBox();
      geo.translate(
        -(geo.boundingBox.min.x + geo.boundingBox.max.x) / 2,
        -geo.boundingBox.min.y,
        0
      );
      geo.scale(SCALE, SCALE, SCALE);
    };

    const dark = darkGeoms.length > 1 ? mergeGeometries(darkGeoms, false) : darkGeoms[0];
    orient(dark);
    const g = dark.index ? dark.toNonIndexed() : dark;
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const nrm = g.getAttribute('normal');
    const triCount = Math.floor(pos.count / 3);
    const AXLE_F = -0.93, AXLE_R = 1.07, HALF_TRACK = 0.44;
    const centers = {
      LF: { x: -HALF_TRACK, z: AXLE_F },
      RF: { x: HALF_TRACK, z: AXLE_F },
      LB: { x: -HALF_TRACK, z: AXLE_R },
      RB: { x: HALF_TRACK, z: AXLE_R },
    };
    const buckets = { LF: [], RF: [], LB: [], RB: [], rest: [] };
    const p0 = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      p0.set(
        (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3,
        (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3,
        (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3
      );
      let best = null, bd = Infinity;
      for (const [key, c] of Object.entries(centers)) {
        const dx = p0.x - c.x, dz = p0.z - c.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = key; }
      }
      const c = centers[best];
      if (
        Math.abs(p0.x - c.x) < 0.36 && Math.abs(p0.z - c.z) < 0.24 &&
        p0.y > 0.004 && p0.y < 0.315
      ) buckets[best].push(t);
      else buckets.rest.push(t);
    }

    if (buckets.rest.length) {
      const n = buckets.rest.length * 3;
      const rp = new Float32Array(n * 3), rc = new Float32Array(n * 3), rn = new Float32Array(n * 3);
      let o = 0;
      for (const t of buckets.rest) {
        for (let k = 0; k < 3; k++) {
          const vi = t * 3 + k;
          rp[o] = pos.getX(vi); rc[o] = col.getX(vi); rn[o] = nrm.getX(vi); o++;
          rp[o] = pos.getY(vi); rc[o] = col.getY(vi); rn[o] = nrm.getY(vi); o++;
          rp[o] = pos.getZ(vi); rc[o] = col.getZ(vi); rn[o] = nrm.getZ(vi); o++;
        }
      }
      const rest = new THREE.BufferGeometry();
      rest.setAttribute('position', new THREE.BufferAttribute(rp, 3));
      rest.setAttribute('color', new THREE.BufferAttribute(rc, 3));
      rest.setAttribute('normal', new THREE.BufferAttribute(rn, 3));
      bodyGeoms.push(rest);
    }

    // Ruedas procedurales redondas y macizas
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.7 });
    for (const key of Object.keys(centers)) {
      const c = centers[key];
      const front = c.z < 0;
      const R = front ? 0.15 : 0.165;
      const W = front ? 0.19 : 0.25;
      const group = new THREE.Group();
      group.rotation.order = 'YZX';
      const tireGeo = new THREE.CylinderGeometry(R, R, W, 36, 1, false);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      group.add(tire);
      const rimGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, W + 0.012, 24, 1, false);
      rimGeo.rotateZ(Math.PI / 2);
      group.add(new THREE.Mesh(rimGeo, rimMat));
      group.position.set(c.x, R, c.z);
      car.add(group);
      wheels.push({ mesh: group, front, spin: 0, R });
    }

    // Carrocería: color por vértice. Para poder "pintarla", sustituimos el
    // color por vertexColors blancos salvo acentos oscuros (alerón, fondo) y
    // aplicamos el color elegido como material con emissive sutil.
    const body = mergeGeometries(bodyGeoms, false);
    orient(body);
    // Decolorar la carrocería: TODO lo que no sea genuinamente negro (0.22)
    // pasa a blanco puro para que el tinte del material sea EXACTO (amarillo,
    // blanco y rosa salen limpios, sin mezclas naranjas del OBJ original).
    {
      const cattr = body.getAttribute('color');
      for (let i = 0; i < cattr.count; i++) {
        const r = cattr.getX(i), gg = cattr.getY(i), b = cattr.getZ(i);
        const lum = 0.3 * r + 0.5 * gg + 0.2 * b;
        if (lum > 0.22) cattr.setXYZ(i, 1, 1, 1);
        else cattr.setXYZ(i, r, gg, b); // acentos oscuros reales (alerón, halo)
      }
    }
    const paintMat = new THREE.MeshStandardMaterial({
      vertexColors: true, color: 0xff7b00, roughness: 0.3, metalness: 0.2,
      emissive: 0x000000, emissiveIntensity: 0.0,
    });
    const bodyMesh = new THREE.Mesh(body, paintMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    car.add(bodyMesh);
    paintableMats = [paintMat];
    playerBodyGeo = body; // los bots clonarán esta misma geometría
    carReady = true;

    placeAtStart();
    applySessionVisuals();
  }, undefined, (err) => {
    OVERLAY.textContent = 'Error cargando el coche: ' + err;
    console.error(err);
  });
}, undefined, (err) => {
  OVERLAY.textContent = 'Error cargando materiales: ' + err;
  console.error(err);
});

function setPlayerColor(hex) {
  for (const m of paintableMats) m.color.set(hex);
  minimap.myColor = hex;
}

// ============================================================
// Física (idéntico modelo: avanza y gira, sin derrape)
// ============================================================
const P = {
  mass: 798,
  wheelbase: 2.0,
  powerW: 560000,
  drsDragMul: 0.82,
  drsPush: 6000,
  drsPushV: 84,
  tractionCap: 14000,
  brakeBase: 46,
  brakeQ: 0.004,
  reverseMax: 8,
  reverseA: 3,
  coastDecel: 3.2,
  maxSteer: 0.5,
  steerFadeV: 26,
  latBase: 32,
  latQ: 0.0075,
  grassMul: 0.7,
  sandMul: 0.45,
  sandDrag: 6.5,
  CdA: 1.56,
  rho: 1.225,
};
const drag = (v) => 0.5 * P.rho * P.CdA * v * v;

const drive = {
  pos: new THREE.Vector3(0, 0, 0),
  heading: 0,
  vx: 0,
  steer: 0,
  omega: 0,
  drs: false,
  drsUsed: false,
  aLat: 0,
  surface: 'asphalt',
};

const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Space'];
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (playing && !paused) { pauseGame(); e.preventDefault(); }
    return;
  }
  if (!playing || paused) return;
  if (e.code === 'KeyC') { e.preventDefault(); cycleCamera(); return; }
  if (e.code === 'KeyR') { e.preventDefault(); restartSession(); return; }
  if (e.code === 'Space') {
    e.preventDefault();
    tryOpenDrs();
    return;
  }
  if (GAME_KEYS.includes(e.code)) { e.preventDefault(); keys.add(e.code); }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter') {
    e.preventDefault();
    if (session && session.mode === 'race') {
      gapDisplay = gapDisplay === 'leader' ? 'ahead' : 'leader';
    }
  }
});
let gapDisplay = 'leader'; // 'leader' | 'ahead': qué intervalos muestra el leaderboard
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { if (!window.__f1KeepKeys) keys.clear(); });

const steerInput = () => (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
const throttleInput = () => keys.has('KeyW');
const brakeInput = () => keys.has('KeyS');

// ============================================================
// Sesiones: free | timetrial | race
// ============================================================
let session = null;
let race = null; // instancia de Race en modo carrera

function defaultSession(mode) {
  return {
    mode,
    playerName: 'PILOTO',
    playerColor: '#ff7b00',
    laps: 0,           // vueltas totales (0 = ilimitadas)
    drsEnabled: true,
    drsRule: 'free',   // free | off | within1s
    countdown: false,
    finished: false,
    finishTime: null,
    disqualified: false,
    best: null,
    last: null,
    t0: 0,
    clockOn: false,    // el reloj de sesión corre desde el inicio (false solo en parrilla)
    running: false,
  };
}

initMenus({
  setVolume: (v) => AUDIO.setVolume(v),
  setSteerSens: (v) => { steerSens = v; },
  startSession(cfg) {
    session = Object.assign(defaultSession(cfg.mode), cfg);
    if (cfg.mode === 'timetrial') { session.laps = cfg.laps; session.drsEnabled = false; session.drsRule = 'off'; }
    if (cfg.mode === 'race') {
      session.laps = cfg.laps || 5;
      session.drsEnabled = true;
      session.drsRule = 'within1s';
      session.countdown = true;
    }
    beginSession();
  },
  resume() { resumeGame(); },
  restartSession() { restartSession(); },
  quitToMenu() { quitToMenu(); },
});

function beginSession() {
  // Menús fuera
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('open');
  // Sin foco residual: ENTER debe controlar los intervalos, no re-disparar botones
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.body.classList.remove('leaderboard');
  OVERLAY.classList.add('hidden');
  keys.clear();
  BLUE_FLAG.classList.remove('on');

  if (race) { race.dispose(); race = null; }
  paused = false;
  playing = true;
  resultsShown = false;
  playerDmg = 0;
  camShake = 0;
  _lapState.prevProg = null;
  AUDIO.start();
  AUDIO.resume();
  AUDIO.startEngine();

  setPlayerColor(session.playerColor);
  HUD_DRIVER.textContent = session.playerName;

  applyHudMode();
  // La sesión SIEMPRE arranca en cámara del coche (persecución): el jugador
  // puede cambiarla con C cuando quiera.
  cameraMode = 'chase';
  camera.fov = CAM_FOV.chase;
  camera.updateProjectionMatrix();
  document.body.classList.remove('nose-cam');
  HUD_MODE.textContent = 'cámara: persecución';

  placeAtStart();

  RACE_STATE.textContent = '';
  RACE_STATE.className = '';
  jumpStartChecked = false;
  raceCreateTime = performance.now();
  sectorDone = {};
  currentSector = 1;
  sectorStart = performance.now();
  timer.best = null;
  timer.last = null;
  // El reloj corre desde el inicio de la sesión, EXCEPTO en carrera: allí
  // empieza exactamente al apagarse las luces (updateRaceFlow).
  timer.running = session.mode !== 'race';
  timer.t0 = performance.now();
  timer.prevSide = 0;
  lapDoneCount = 0;
  if (session.mode === 'race') {
    // El reloj NO arranca en la parrilla: empieza exactamente al apagarse
    // las luces (updateRaceFlow se encarga).
    session.t0 = performance.now();
    session.clockOn = false;
    session.best = null; session.last = null;
    lapCounter.laps = 0;
    race = new Race(scene, track, {
      playerColor: session.playerColor,
      difficulty: session.difficulty,
      playerName: session.playerName,
      playerBodyGeo,
    });
    race.totalLaps = session.laps;
    race.onPlayerHit = (impact) => {
      playerDmg = Math.min(1, playerDmg + impact * 0.4);
      camShake = Math.min(0.9, camShake + impact * 0.8);
    };
    // El jugador sale donde le tocó en la parrilla barajada
    drive.pos.copy(race.playerStart.pos);
    drive.heading = race.playerStart.heading;
    car.position.copy(drive.pos);
    car.rotation.y = drive.heading;
    showLights(true); // sin leaderboard hasta que se apaguen las luces
  } else {
    if (session.mode === 'timetrial') { timer.best = null; ttLaps.length = 0; }
    timer.last = null;
    session.t0 = timer.t0;
    session.clockOn = true; // libre/cronometraje: cuenta desde el inicio
    session.best = session.mode === 'timetrial' ? null : session.best;
    RACE_STATE.textContent = '';
  }
}
let raceCreateTime = 0;
let jumpStartChecked = false;

function applyHudMode() {
  // En juego libre no hay cronometro oficial
  document.getElementById('timing').style.display = session && session.mode === 'free' ? 'none' : '';
}

function showLights(on) {
  screens.lights(on);
  if (on) {
    race.lights = 0;
    race.allOn = false;
    race.lightsT = 0;
    race.lightsHold = 0;
    race.phase = 'countdown';
    document.querySelectorAll('#lights-gantry .bulb').forEach((b) => b.classList.remove('on'));
  } else {
    RACE_STATE.textContent = '';
    RACE_STATE.className = '';
  }
}

function tryOpenDrs() {
  if (!session || !session.drsEnabled || drive.drs || drive.drsUsed) return;
  if (race && race.phase !== 'green') return; // antes del semáforo no hay DRS
  if (!track.isDrsZone(drive.pos.x, drive.pos.z)) return;
  if (session.drsRule === 'within1s') {
    const g = gapAheadSeconds();
    if (g == null || g > 1.0) return; // solo con rival a <1 s
  }
  drive.drs = true;
}

// Diferencia de tiempo con el coche de delante (s en la progresión)
function gapAheadSeconds() {
  if (!race) return null;
  const myU = track.arcOf(drive.pos.x, drive.pos.z);
  const standings = race.liveStandings(session.playerName, session.playerColor, session.finished && session.finishTime != null, playerLapCount());
  const myIdx = standings.findIndex((r) => r.isPlayer);
  if (myIdx <= 0) return null; // primero: nadie delante
  const ahead = standings[myIdx - 1];
  const aheadU = ahead.isPlayer ? track.arcOf(drive.pos.x, drive.pos.z) : race.bots.find((b) => b.tag === ahead.tag).u;
  const dist = track.lapDist(myU, aheadU);
  const myV = Math.max(Math.abs(drive.vx), 15);
  return dist / myV;
}

function playerLapCount() {
  return lapCounter.laps;
}

// ============================================================
// Cronómetro (libre + cronometraje)
// ============================================================
const timer = { running: false, t0: 0, current: null, last: null, best: null, prevSide: 0 };
const lapCounter = { laps: 0, prevSide: 0, armed: false };

function fmtTime(ms) {
  if (ms == null) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const th = Math.floor(ms % 1000);
  return m + ':' + String(s).padStart(2, '0') + '.' + String(th).padStart(3, '0');
}

function lineFrame() {
  const tg = track.startTangent;
  return { gx: track.startPos.x, gz: track.startPos.z, tgx: tg.x, tgz: tg.z, nlx: -tg.z, nlz: tg.x };
}

function updateLapTimer() {
  if (!session) return;
  const now = performance.now();
  // Progreso longitudinal REAL (fracción de vuelta desde la línea de meta,
  // siguiendo la curva): inmune a los falsos cruces de los esses.
  const u = track.arcOf(drive.pos.x, drive.pos.z);
  if (track._startArc == null) track._startArc = track.arcOf(track.startPos.x, track.startPos.z);
  const prog = ((u - track._startArc) % 1 + 1) % 1; // 0 = línea de meta
  if (_lapState.prevProg == null) _lapState.prevProg = prog;
  const prev = _lapState.prevProg;
  const fwd = ((prog - prev) % 1 + 1) % 1; // avance hacia delante (0..1)
  const bwd = ((prev - prog) % 1 + 1) % 1; // retroceso
  const inf = track.info(drive.pos.x, drive.pos.z);
  const onRoad = Math.abs(inf.lat) < track.roadHalf + track.kerbW + 2;
  const racing = session.mode !== 'free' && (!race || race.phase === 'green') && !session.disqualified;
  lastLapProg = prog;

  // ---- Sectores FÍSICOS: marcas a 1/3 y 2/3 de vuelta, solo hacia delante ----
  if (onRoad && racing && session.clockOn) {
    if (prev < 1 / 3 && prog >= 1 / 3 && fwd < 0.5) sectorComplete(1, now);
    else if (prev < 2 / 3 && prog >= 2 / 3 && fwd < 0.5) sectorComplete(2, now);
  }

  if (!onRoad) { _lapState.prevProg = prog; return; }

  // ---- Línea de META: en carrera el primer cruce (desde la parrilla) ARMA
  // la vuelta sin registrar tiempo falso; los siguientes cierran vueltas. ----
  if (fwd < 0.5 && prog < prev) {
    const armaVuelta = session.mode === 'race' && lapCounter.laps === 0 && !lapCounter.armed;
    if (armaVuelta) {
      // Primer cruce tras la salida: ARMA la vuelta (no registra tiempo falso
      // de los ~2 s desde la parrilla). El cronómetro de vuelta reinicia aquí:
      // las vueltas registradas serán línea-a-línea exactas.
      lapCounter.armed = true;
      lapCounter.laps = 0;
      timer.t0 = now;
      sectorStart = now;
      sectorDone = {};
    } else {
      const t = now - timer.t0;              // tiempo de la VUELTA (línea a línea)
      const valido = session.lapInvalid != true;
      session.last = t;
      timer.last = t;
      if (valido) {
        if (session.best == null || t < session.best) {
          session.best = t;
          AUDIO.fastLap();
        }
        if (timer.best == null || t < timer.best) timer.best = t;
        // Sector 3 de la vuelta que cierra
        if (racing && session.clockOn) sectorComplete(3, now);
        // Cronometraje: vuelta válida completada
        if (session.mode === 'timetrial' && !session.finished) {
          ttLaps.push(t);
          lapDoneCount++;
          if (lapDoneCount >= session.laps) {
            session.finished = true;
            showTimetrialResults();
          }
        }
        // Carrera: meta final tras completar las vueltas configuradas
        if (session.mode === 'race' && !session.finished && lapCounter.laps >= session.laps) {
          session.finished = true;
          session.finishTime = now;
          if (race) race.finishPlayer(now);
          RACE_STATE.textContent = '¡BANDERA A CUADROS!';
          RACE_STATE.className = 'green';
        }
      }
      if (session.mode === 'race') lapCounter.laps++;
    }
    // NUEVA vuelta: el cronómetro SIEMPRE sigue contando (no se para nunca).
    // Marca el inicio de la vuelta: el HUD muestra tiempo de VUELTA.
    session.lapInvalid = false;
    timer.running = true;
    timer.t0 = now;
    sectorStart = now;
    sectorDone = {};
  } else if (bwd < 0.5 && prog > prev) {
    session.lapInvalid = true; // cruzó la meta hacia atrás: esa vuelta no valdrá
  }
  _lapState.prevProg = prog;
  // Cronómetro grande = tiempo de la VUELTA EN CURSO (el global solo existe
  // al final, en la clasificación).
  timer.current = session.clockOn ? now - timer.t0 : null;
}
const _lapState = { prevProg: null };
let lastLapProg = 0; // progreso en la vuelta actual (lo usa el delta del HUD)

// Registra un parcial de sector con flash + color (verde = mejor personal)
function sectorComplete(n, now) {
  const t = now - sectorStart;
  if (sectorDone[n]) return; // ya registrado en esta vuelta
  sectorDone[n] = t;
  sectorStart = now;
  currentSector = n === 3 ? 1 : n + 1;
  if (!session.bestSectors) session.bestSectors = {};
  const isBest = session.bestSectors[n] == null || t < session.bestSectors[n];
  if (isBest) session.bestSectors[n] = t;
  SECTOR_NAME.textContent = 'SECTOR ' + n;
  SECTOR_TIME.textContent = fmtTime(t).replace(/^0:/, '');
  SECTOR_TIME.style.color = isBest ? '#b455ff' : '#ffd23d';
  AUDIO.sectorFestival(isBest);
  SECTOR_FLASH.classList.add('show');
  clearTimeout(sectorFlashTO);
  sectorFlashTO = setTimeout(() => SECTOR_FLASH.classList.remove('show'), 1700);
}
let lapDoneCount = 0; // vueltas válidas completadas (cronometraje)
const ttLaps = [];    // tiempos de cada vuelta válida
let sectorStart = 0, currentSector = 1, sectorFlashTO = null;
let sectorDone = {};

// ============================================================
// placeAtStart / cámaras
// ============================================================
function placeAtStart() {
  let pos = track.startPos, heading = track.startHeading;
  if (session && session.mode === 'race' && race) {
    pos = race.playerStart.pos; heading = race.playerStart.heading;
  }
  drive.pos.copy(pos);
  drive.heading = heading;
  drive.vx = drive.steer = drive.omega = 0;
  drive.drs = false;
  drive.drsUsed = false;
  drsZonePrev = false;
  playerDmg = 0;
  camShake = 0;
  resultsShown = false;
  _lapState.prevProg = null;
  car.position.copy(drive.pos);
  car.rotation.y = drive.heading;
  timer.running = false;
  timer.current = null;
  timer.prevSide = 0;
  lapCounter.laps = 0;
  lapCounter.prevSide = 0;
  lapCounter.armed = false;
  lapDoneCount = 0;
  session && (session.finished = false, session.finishTime = null, session.disqualified = false);
}

const CAM_MODES = ['chase', 'nose'];
const CAM_FOV = { chase: 62, nose: 74 };
let cameraMode = 'chase';
function cycleCamera() {
  cameraMode = CAM_MODES[(CAM_MODES.indexOf(cameraMode) + 1) % CAM_MODES.length];
  camera.fov = CAM_FOV[cameraMode];
  camera.updateProjectionMatrix();
  document.body.classList.toggle('nose-cam', cameraMode === 'nose');
  HUD_MODE.textContent = {
    chase: 'cámara: persecución',
    nose: 'cámara: morro',
  }[cameraMode];
}

// ============================================================
// Paso de física
// ============================================================
let drsZonePrev = false;

function physicsStep(dt) {
  const st = drive;

  const target = steerInput();
  const rate = (target !== 0 ? 4.2 : 6.5) * steerSens;
  st.steer += THREE.MathUtils.clamp(target - st.steer, -rate * dt, rate * dt);
  const v = st.vx;
  const vAbs = Math.abs(v);
  const delta = st.steer * P.maxSteer * Math.exp(-vAbs / P.steerFadeV);

  const inf = track.info(st.pos.x, st.pos.z);
  const offTrack = Math.abs(inf.lat) > track.roadHalf + track.kerbW * 0.6;
  const inSand = offTrack && track.isSand(st.pos.x, st.pos.z);
  st.surface = inSand ? 'sand' : (offTrack ? 'grass' : 'asphalt');
  const grip = inSand ? P.sandMul : (offTrack ? P.grassMul : 1);

  let a = 0;
  const braking = brakeInput();
  if (throttleInput()) {
    if (v >= -0.5) {
      let F = Math.min(P.powerW / Math.max(vAbs, 8), P.tractionCap * grip);
      if (st.drs) F += P.drsPush * Math.max(0, 1 - vAbs / P.drsPushV);
      a = F / P.mass;
    } else {
      a = Math.min(P.brakeBase * 0.7, -v / dt);
    }
  } else if (braking) {
    if (v > 0.4) {
      const bd = offTrack
        ? Math.min((P.brakeBase + P.brakeQ * vAbs * vAbs) * grip, 9)
        : P.brakeBase + P.brakeQ * vAbs * vAbs;
      a = -Math.min(bd, v / dt);
    } else if (v > -P.reverseMax) {
      a = -P.reverseA;
    }
  } else {
    a = -Math.sign(v) * Math.min(P.coastDecel, vAbs / dt);
  }
  if (inSand && vAbs > 0.3) a -= Math.sign(v) * Math.min(P.sandDrag, vAbs / dt);
  a -= (Math.sign(v) * drag(vAbs) * (st.drs ? P.drsDragMul : 1)) / P.mass;

  st.vx = v + a * dt;
  if (v > 0 && st.vx < 0 && !braking) st.vx = 0;
  if (v < 0 && st.vx > 0 && !throttleInput()) st.vx = 0;
  st.vx = THREE.MathUtils.clamp(st.vx, -P.reverseMax, 95 * (1 - playerDmg * 0.07));

  const inZone = track.isDrsZone(st.pos.x, st.pos.z);
  if (inZone && !drsZonePrev) st.drsUsed = false;
  drsZonePrev = inZone;
  if (st.drs && (braking || !inZone)) { st.drs = false; st.drsUsed = true; }
  // Daño por golpes: se recupera en ~6 s (pérdida de punta y agarre temporal)
  playerDmg = Math.max(0, playerDmg - dt / 6);

  const steerOmega = (st.vx * Math.tan(delta)) / P.wheelbase;
  const maxLat = (P.latBase + P.latQ * vAbs * vAbs) * grip;
  const gripOmega = (Math.sign(steerOmega) * maxLat) / Math.max(vAbs, 0.1);
  st.omega = Math.abs(steerOmega) > Math.abs(gripOmega) ? gripOmega : steerOmega;

  st.heading += st.omega * dt;
  const fwdX = -Math.sin(st.heading), fwdZ = -Math.cos(st.heading);
  st.pos.x += fwdX * st.vx * dt;
  st.pos.z += fwdZ * st.vx * dt;

  st.aLat = Math.abs(st.omega * st.vx) / 9.81;
}

function updateWheels(dt) {
  const delta = drive.steer * P.maxSteer * Math.exp(-Math.abs(drive.vx) / P.steerFadeV);
  for (const w of wheels) {
    w.spin -= (drive.vx / w.R) * dt;
    w.mesh.rotation.x = w.spin;
    if (w.front) w.mesh.rotation.y = delta;
  }
}

function updatePhysics(dt) {
  const h = dt / 2;
  physicsStep(h);
  physicsStep(h);
  const cols = track.collideFence(drive.pos.x, drive.pos.z);
  if (cols.length) {
    let deepest = cols[0];
    for (const c of cols) if (c.depth > deepest.depth) deepest = c;
    drive.pos.addScaledVector(deepest.n, deepest.depth);
    const fwdX = -Math.sin(drive.heading), fwdZ = -Math.cos(drive.heading);
    const vn = fwdX * deepest.n.x + fwdZ * deepest.n.z;
    if (vn < 0) {
      const impact = Math.min(1, -vn / 40);
      drive.vx = Math.max(0, drive.vx + vn * 1.35);
      AUDIO.crash(0.3 + impact);
      playerDmg = Math.min(1, playerDmg + impact * 0.5);
      camShake = Math.min(0.9, camShake + impact);
    }
  }

  car.position.copy(drive.pos);
  car.rotation.y = drive.heading;
  updateWheels(dt);
  updateLapTimer();

  drsFlap.rotation.x = drive.drs ? -0.95 : 0;
  const braking = brakeInput() || (throttleInput() && drive.vx < -0.3);
  brakeMat.emissiveIntensity = braking ? 2.4 : 0.05;

  sun.position.set(drive.pos.x + 12, 20, drive.pos.z + 8);
  sun.target.position.copy(drive.pos);
}

// ============================================================
// Cámaras
// ============================================================
const _f = new THREE.Vector3(), _look = new THREE.Vector3();
function updateChaseCamera() {
  _f.set(-Math.sin(drive.heading), 0, -Math.cos(drive.heading));
  camera.position.copy(drive.pos)
    .addScaledVector(_f, -5.0)
    .add(new THREE.Vector3(0, 2.6, 0));
  // Sacudida por impactos (decae en ~0.5 s)
  if (camShake > 0.01) {
    const t = performance.now() / 1000;
    camera.position.x += Math.sin(t * 47) * camShake * 0.18;
    camera.position.y += Math.sin(t * 59 + 1.7) * camShake * 0.13;
    camShake = Math.max(0, camShake - 0.055);
  }
  _look.copy(drive.pos).addScaledVector(_f, 4.0).add(new THREE.Vector3(0, 0.7, 0));
  camera.lookAt(_look);
}
function updateNoseCamera(t) {
  car.updateMatrixWorld();
  const vAbs = Math.abs(drive.vx);
  const sh = Math.pow(Math.min(1, vAbs / 85), 2) * 0.006;
  _f.set(
    Math.sin(t * 41 + 2.1) * sh * 0.7,
    0.6 + Math.sin(t * 31) * sh + Math.sin(t * 57 + 1.3) * sh * 0.5,
    -0.5
  );
  car.localToWorld(_f);
  camera.position.copy(_f);
  _look.set(0, 0.2, -10);
  car.localToWorld(_look);
  camera.lookAt(_look);
}

// ============================================================
// HUD
// ============================================================
const HUD_LEDS = [];
(function buildLeds() {
  const wrap = document.getElementById('leds');
  if (!wrap) return;
  for (let i = 0; i < 15; i++) {
    const s = document.createElement('span');
    wrap.appendChild(s);
    HUD_LEDS.push(s);
  }
})();

const GEAR_TOPS = [95 / 3.6, 145 / 3.6, 195 / 3.6, 245 / 3.6, 290 / 3.6, 330 / 3.6];
function gearOf(vAbs) {
  for (let i = 0; i < GEAR_TOPS.length; i++) if (vAbs <= GEAR_TOPS[i]) return i + 1;
  return 6;
}

let lastKmh = -1;
let lastGear = '';
let lastLedLit = -1;
function updateHUD() {
  const vAbs = Math.abs(drive.vx);
  const kmh = Math.round(vAbs * 3.6);
  if (kmh !== lastKmh) { lastKmh = kmh; HUD_SPEED.textContent = kmh; }

  const g = vAbs < 0.4 ? 'N' : (drive.vx < -0.5 ? 'R' : gearOf(vAbs));
  if (g !== lastGear) {
    lastGear = g;
    HUD_GEAR.textContent = g;
    HUD_GEAR.classList.add('shift');
    setTimeout(() => HUD_GEAR.classList.remove('shift'), 140);
  }
  // Guardamos la fracción de marcha para el motor de audio (tick la usa)

  const gi = Math.min(5, Math.max(0, gearOf(vAbs) - 1));
  const lo = gi === 0 ? 0 : GEAR_TOPS[gi - 1];
  const hi = GEAR_TOPS[gi];
  const frac = hi > lo ? (vAbs - lo) / (hi - lo) : 0;
  const lit = Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 15);
  if (lit !== lastLedLit) {
    lastLedLit = lit;
    for (let i = 0; i < 15; i++) {
      HUD_LEDS[i].className = i < lit ? (i < 7 ? 'on-g' : (i < 12 ? 'on-r' : 'on-b')) : '';
    }
  }

  HUD_REV.style.width = Math.min(100, (kmh / 330) * 100) + '%';

  const surf = drive.surface;
  HUD_SURF.textContent = surf === 'asphalt' ? 'ASFALTO' : (surf === 'sand' ? 'ARENA' : 'HIERBA');
  HUD_SURF.className = surf === 'sand' ? 'surf-s' : (surf === 'grass' ? 'surf-g' : '');

  HUD_BAR_T.style.height = (throttleInput() ? 100 : 0) + '%';
  HUD_BAR_B.style.height = (brakeInput() ? 100 : 0) + '%';

  // DRS
  const inZone = track.isDrsZone(drive.pos.x, drive.pos.z);
  let drsAvailable = inZone && !drive.drs && !drive.drsUsed;
  if (session && session.drsRule === 'within1s' && drsAvailable) {
    const gap = gapAheadSeconds();
    if (gap == null || gap > 1.0) drsAvailable = false;
  }
  if (session && !session.drsEnabled) drsAvailable = false;
  HUD_DRS.classList.toggle('open', drive.drs);
  HUD_DRS.classList.toggle('available', drsAvailable);
  HUD_DRS.classList.toggle('used', inZone && !drive.drs && drive.drsUsed);
  DRS_SUB.textContent = drive.drs ? 'ABIERTA' : (drive.drsUsed ? 'USADA' : (drsAvailable ? 'ESPACIO' : '—'));
  HUD_CHIP.classList.toggle('open', drive.drs);
  HUD_CHIP.classList.toggle('available', drsAvailable);
  HUD_CHIP.classList.toggle('used', inZone && !drive.drs && drive.drsUsed);
  HUD_CHIP_SUB.textContent = DRS_SUB.textContent;

  // Cronómetro grande = tiempo de la VUELTA EN CURSO (línea a línea).
  if (session && session.clockOn) HUD_TIME.textContent = fmtTime(performance.now() - timer.t0);
  else HUD_TIME.textContent = fmtTime(null);
  HUD_TIME.classList.toggle('invalid', !!(session && session.lapInvalid));
  HUD_LAST.textContent = fmtTime(session ? session.last : timer.last);
  HUD_BEST.textContent = fmtTime(session && session.best != null ? session.best : timer.best);
  // Delta vivo con la mejor vuelta (verde = ganando, morado = mejor vuelta)
  if (session && session.best != null && session.clockOn && race && race.phase === 'green'
      && lapCounter.armed && drive.vx > 8) {
    const refT = lastLapProg * session.best; // tiempo ideal de la referencia en ese punto
    const curT = performance.now() - timer.t0;
    const d = (curT - refT) / 1000;
    HUD_DELTA.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
    HUD_DELTA.className = d <= 0.02 ? 'better' : 'worse';
  } else {
    HUD_DELTA.textContent = '—';
    HUD_DELTA.className = '';
  }
  HUD_TIME.classList.toggle('invalid', !!(session && session.lapInvalid));
  HUD_LAST.textContent = fmtTime(session ? session.last : timer.last);
  HUD_BEST.textContent = fmtTime(session && session.best != null ? session.best : timer.best);
  if (session && session.mode === 'timetrial') {
    HUD_LAPCOUNT.textContent = 'VUELTA ' + Math.min(lapDoneCount + 1, session.laps) + '/' + session.laps;
  } else if (session && session.mode === 'race') {
    // La carrera SIEMPRE empieza en la vuelta 1 (el cruce de meta cierra la 1ª)
    HUD_LAPCOUNT.textContent = 'VUELTA ' + Math.min(Math.max(lapCounter.laps, 1), session.laps) + '/' + session.laps;
  } else if (session && session.mode === 'free') {
    HUD_LAPCOUNT.textContent = 'LIBRE';
  } else {
    HUD_LAPCOUNT.textContent = 'VUELTA —';
  }

  // Chip de daño (visible tras golpes; se recupera en ~6 s)
  HUD_DMG.classList.toggle('on', playerDmg > 0.06);
  const dmgSpan = HUD_DMG.querySelector('span');
  if (dmgSpan) dmgSpan.textContent = Math.round(playerDmg * 100) + '%';

  // Posición grande (P#) + intervalo con el de delante
  if (race && session.mode === 'race') {
    const rows = race.lastStandings || [];
    const myIdx = Math.max(0, rows.findIndex((r) => r.isPlayer));
    POS_BIG_P.textContent = 'P' + (myIdx + 1);
    POS_BIG_L.textContent = 'DE ' + rows.length;
    POS_BIG_P.parentElement.classList.add('on');
  } else {
    POS_BIG_P.parentElement.classList.remove('on');
  }

  // Minimapa + rivales
  let rivals;
  if (race) {
    rivals = race.bots.map((b) => ({ x: b.pos.x, z: b.pos.z, color: b.color }));
    race.updatePlayerProgress(drive.pos.x, drive.pos.z);
    // Bots que terminan sus vueltas
    for (const b of race.bots) {
      if (b.finishTime == null && b.lap >= session.laps + 1) b.finishTime = performance.now();
    }
    updateBoard();
    // Bandera azul: un bot con vuelta ventaja está a punto de doblarme
    // (distancia HACIA DELANTE desde el jugador hasta el bot)
    const pU = race.playerProgress.u;
    const blue = race.bots.some((b) => b.lap >= lapCounter.laps + 1 && track.lapDist(pU, b.u) < 220);
    BLUE_FLAG.classList.toggle('on', blue && !session.finished && !session.disqualified);
  } else {
    BLUE_FLAG.classList.remove('on');
  }

  minimap.update(drive.pos.x, drive.pos.z, drive.heading, rivals);
}

// ---- Leaderboard en vivo ----
// gapDisplay: 'leader' = distancia con el líder (por defecto), 'ahead' = con el
// piloto de delante. Se cambia con ENTER.
let lastBoardHTML = '';
function updateBoard() {
  if (!race || !session) return;
  const rows = race.liveStandings(session.playerName, session.playerColor, session.finished && session.finishTime != null, lapCounter.laps);
  race.lastStandings = rows;
  const myIdx = rows.findIndex((r) => r.isPlayer);
  const leader = rows[0];
  if (BOARD_MODE) BOARD_MODE.textContent = gapDisplay === 'leader' ? 'VS LÍDER' : 'VS DELANTERO';
  let html = '';
  const show = Math.min(rows.length, 8);
  for (let i = 0; i < show; i++) {
    const r = rows[i];
    let gapTxt = 'LÍDER';
    if (i > 0) {
      if (r.finishTime != null && leader.finishTime != null) {
        gapTxt = '+' + ((r.finishTime - leader.finishTime) / 1000).toFixed(1);
      } else {
        let refRow, sign;
        if (gapDisplay === 'leader') { refRow = leader; sign = '+'; }
        else {
          const k = Math.max(0, i - 1);
          refRow = rows[k];
          sign = i > k ? '+' : '-';
        }
        const dist = track.lapDist(refRow.prog, r.prog); // distancia hacia atrás
        gapTxt = sign + (dist / 80).toFixed(1) + 's';
      }
    } else if (r.finishTime != null) {
      gapTxt = 'META';
    }
    const me = r.isPlayer ? ' me' : '';
    html += '<div class="b-row' + me + '">'
      + '<span class="b-pos">' + (i + 1) + '</span>'
      + '<span class="b-tape" style="background:' + r.color + '"></span>'
      + '<span class="b-tag" style="background:' + r.color + '">' + r.tag + '</span>'
      + '<span class="b-name">' + (r.isPlayer ? session.playerName : r.name) + '</span>'
      + '<span class="b-gap">' + gapTxt + '</span>'
      + '</div>';
  }
  if (html !== lastBoardHTML) { lastBoardHTML = html; BOARD_ROWS.innerHTML = html; }

  // Estado de carrera
  if (session.finished || session.disqualified) {
    // banda a cuadros / DSQ ya puesta en su momento
  } else if (race.phase === 'green' && myIdx === 0 && lapCounter.laps >= 2 && !RACE_STATE.textContent) {
    RACE_STATE.textContent = 'P1 · LÍDER';
    RACE_STATE.className = 'green';
  } else if (RACE_STATE.textContent === 'P1 · LÍDER' && myIdx !== 0) {
    RACE_STATE.textContent = '';
    RACE_STATE.className = '';
  }
}

// ============================================================
// Carrera: flujo de salida y final
// ============================================================
function updateRaceFlow(dt) {
  if (!race || !session || session.mode !== 'race') return;
  if (race.phase === 'countdown') {
    race.updateLights(dt);
    // Bombillas: fila horizontal de 5 (la columna i se enciende al llegar a i+1 luces)
    const cols = document.querySelectorAll('#lights-gantry .light-col');
    cols.forEach((col, ci) => {
      const bulb = col.querySelector('.bulb');
      if (bulb) bulb.classList.toggle('on', race.lights > ci);
    });
    // Beep al encenderse cada luz + tu posición grande en la parrilla
    if (race.lights !== race._lastBeep) {
      race._lastBeep = race.lights;
      AUDIO.lightBeep();
      POS_BIG_P.textContent = 'P' + (race.playerGridPos || 1);
      POS_BIG_L.textContent = 'DE 8';
      POS_BIG_P.parentElement.classList.add('on');
    }
    // Salto en falso: cualquier movimiento antes del apagado se castiga AL INSTANTE
    if (!session.disqualified && Math.abs(drive.vx) > 0.5) {
      race.jumpStart = true;
      session.disqualified = true;
      session.finished = true;
      race.phase = 'green';
      showLights(false);
      jumpStartChecked = true;
      RACE_STATE.textContent = 'SALTO EN FALSO · DESCALIFICADO';
      RACE_STATE.className = 'yellow';
      return;
    }
    return;
  }
  // Justo al apagarse (salida limpia)
  if (!jumpStartChecked && race.phase === 'green') {
    jumpStartChecked = true;
    showLights(false);
    AUDIO.lightsGo();
    document.body.classList.add('leaderboard');
    gapDisplay = 'leader';
    RACE_STATE.textContent = '¡LUCES FUERA!';
    RACE_STATE.className = 'green';
    setTimeout(() => { if (RACE_STATE.textContent === '¡LUCES FUERA!') RACE_STATE.textContent = ''; }, 1500);
    // AQUÍ arranca el reloj (el HUD muestra tiempo de vuelta; la vuelta 1 se
    // cierra al CRUZAR la meta por primera vez — nada de tiempos falsos).
    timer.t0 = performance.now();
    timer.running = true;
    session.t0 = timer.t0;
    session.clockOn = true;
    lapCounter.laps = 0;
    lapCounter.armed = false; // el primer cruce arma la vuelta sin registrar tiempo
    sectorStart = timer.t0;
    sectorDone = {};
    currentSector = 1;
  }
}

function endRace() {
  if (!session || !race || resultsShown) return;
  resultsShown = true;
  playing = false;
  AUDIO.stopEngine();
  const rows = race.liveStandings(session.playerName, session.playerColor, session.finished, lapCounter.laps);
  const finishOrder = rows.filter((r) => r.finishTime != null);
  const dnf = rows.filter((r) => r.finishTime == null);
  const ordered = [...finishOrder, ...dnf];
  let html = '';
  const finishers = ordered.filter((r) => r.finishTime != null);
  const bestOf = finishers.length ? Math.min(...finishers.map((r) => r.finishTime)) : null;
  const bestLapAll = Math.min(...rows.filter((r) => r.bestLap != null).map((r) => r.bestLap), Infinity);
  ordered.forEach((r, i) => {
    const me = r.isPlayer ? ' me' : '';
    const fl = r.bestLap != null && r.bestLap === bestLapAll ? ' <span class="r-fl">V.RAPIDA</span>' : '';
    const timeTxt = r.finishTime != null
      ? (i === 0 ? fmtTime(r.finishTime - raceCreateTime) : '+' + ((r.finishTime - bestOf) / 1000).toFixed(3) + ' s')
      : (r.isPlayer && session.disqualified ? '<span class="r-dnf">DSQ · SALTO EN FALSO</span>' : '<span class="r-dnf">DNF</span>');
    const lapTxt = r.bestLap != null ? fmtTime(r.bestLap).replace(/^0:/, '') : '—';
    html += '<div class="r-row' + me + '">'
      + '<span class="r-pos">P' + (i + 1) + '</span>'
      + '<span class="r-tape" style="background:' + r.color + '"></span>'
      + '<span class="r-name">' + (r.isPlayer ? session.playerName : r.name) + fl + '</span>'
      + '<span class="r-blap">' + lapTxt + '</span>'
      + '<span class="r-time' + (r.finishTime === bestOf ? ' best' : '') + '">' + timeTxt + '</span>'
      + '</div>';
  });
  document.getElementById('results-list').innerHTML = html;
  document.getElementById('results-title').textContent = 'RESULTADOS · ' + session.laps + ' VUELTAS';
  screens.results(true);
}

function showTimetrialResults() {
  if (resultsShown) return;
  resultsShown = true;
  AUDIO.stopEngine();
  const best = Math.min(...ttLaps);
  let html = ttLaps.map((t, i) =>
    '<div class="r-row' + (t === best ? ' me' : '') + '"><span class="r-pos">V' + (i + 1) + '</span>'
    + '<span class="r-tape" style="background:' + session.playerColor + '"></span>'
    + '<span class="r-name">VUELTA ' + (i + 1) + (t === best ? ' <span class="r-fl">MEJOR</span>' : '') + '</span>'
    + '<span class="r-time' + (t === best ? ' best' : '') + '">' + fmtTime(t) + '</span></div>'
  ).join('');
  html += '<div class="r-total">MEJOR VUELTA · ' + fmtTime(best) + '</div>';
  document.getElementById('results-list').innerHTML = html;
  document.getElementById('results-title').textContent = session.playerName + ' · ' + session.laps + ' VUELTAS CRONOMETRADAS';
  screens.results(true);
}

// ============================================================
// Pausa / reinicio / menú
// ============================================================
function pauseGame() {
  if (!playing || paused) return;
  paused = true;
  AUDIO.stopEngine();
  screens.pause(true);
}
function resumeGame() {
  paused = false;
  screens.pause(false);
  keys.clear();
  AUDIO.resume();
  AUDIO.startEngine();
}
function restartSession() {
  if (!session) return;
  screens.pause(false);
  screens.results(false);
  AUDIO.stopEngine();
  AUDIO.startEngine();
  const cfg = { ...session };
  const mode = cfg.mode;
  session = Object.assign(defaultSession(mode), cfg, {
    finished: false, finishTime: null, disqualified: false, lapInvalid: false,
    clockOn: false, best: cfg.mode === 'free' ? cfg.best : null,
  });
  if (mode === 'timetrial') { ttLaps.length = 0; }
  jumpStartChecked = false;
  beginSession();
}
function quitToMenu() {
  playing = false;
  paused = false;
  session = null;
  AUDIO.stopEngine();
  if (race) { race.dispose(); race = null; }
  screens.pause(false);
  screens.results(false);
  document.body.classList.remove('leaderboard');
  placeAtStart();
  screens.home();
}

// ============================================================
// Bucle
// ============================================================
let last = performance.now();
let _lastGearSnd = 1;
function tick(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (playing && !paused && carReady) {
    if (session && session.mode === 'race' && race) {
      updateRaceFlow(dt);
      // La física sigue SIEMPRE activa (el flujo congela el coche en
      // countdown); los bots corren desde el apagado, incluso tras tu meta.
      updatePhysics(dt);
      if (race.phase === 'green') {
        race.stepBots(dt, drive, P, AUDIO);
      }
      if (session.disqualified && !resultsShown && !race._dsqTimer) {
        AUDIO.stopEngine();
        race._dsqTimer = setTimeout(() => endRace(), 2600);
      }
      if (session.finished && session.finishTime != null && race.isFinished()) endRace();
    } else {
      updatePhysics(dt);
    }
    // Motor: revs = fracción dentro de la marcha actual, load = gas
    const gi = Math.min(5, Math.max(0, gearOf(Math.abs(drive.vx)) - 1));
    const lo = gi === 0 ? 0 : GEAR_TOPS[gi - 1];
    const hi = GEAR_TOPS[gi];
    lastFrac = hi > lo ? THREE.MathUtils.clamp((Math.abs(drive.vx) - lo) / (hi - lo), 0, 1) : 0;
    AUDIO.updateEngine(lastFrac, throttleInput() ? 1 : 0, !session.disqualified);
    // Sonido del cambio de marcha (solo subiendo de marcha)
    const gearNow = gearOf(Math.abs(drive.vx));
    if (gearNow !== _lastGearSnd && gearNow > _lastGearSnd && drive.vx > 2) AUDIO.shiftGear();
    _lastGearSnd = gearNow;
  } else if (!playing) {
    AUDIO.updateEngine(0, 0, false);
  }

  if (cameraMode === 'chase') updateChaseCamera();
  else updateNoseCamera(now / 1000);
  updateHUD();
  renderer.render(scene, camera);
  if (cameraMode === 'nose') updateRearView();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizeRearView();
});

function applySessionVisuals() {
  if (session) setPlayerColor(session.playerColor);
}

placeAtStart();
document.body.classList.toggle('nose-cam', false);

window.__f1debug = {
  car, scene, camera, renderer, track, drive, wheels, drsFlap, brakeMat, minimap,
  rearCam, rearRenderer, updateRearView, sizeRearView, physicsStep, P,
  get playing() { return playing; },
  get session() { return session; },
  get race() { return race; },
  get timerState() { return timer; },
  get lapCounterState() { return lapCounter; },
  get ttLaps() { return ttLaps; },
  get gapDisplay() { return gapDisplay; },
  cycleCamera, keys, placeAtStart, updatePhysics, updateHUD, timer,
  showTimetrialResults, screens,
  updateRaceFlow, tryOpenDrs, gapAheadSeconds, restartSession, quitToMenu,
  startFree: () => {
    session = Object.assign(defaultSession('free'), { playerName: 'PILOTO', playerColor: '#ff7b00' });
    beginSession();
  },
  startGame: null,
  gapAheadSeconds, endRace,
};
window.__f1debug.startGame = window.__f1debug.startFree;
