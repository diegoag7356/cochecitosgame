import * as THREE from 'three';

// ============================================================
// Director de carrera v3:
//  · 7 bots = tu mismo coche (clon de la carrocería OBJ) con
//    7 colores repartidos de la paleta exacta (sin el tuyo).
//  · Cada bot tiene CEREBRO PROPIO: punto de frenada, agresividad
//    de trazada, línea preferida, ritmo en curva, errores propios
//    y defensa de línea. Nadie piensa igual.
//  · Físicas idénticas al jugador (misma P y grip).
//  · Colisiones con impulso real, rotación por toque y daño.
//  · Anti-suicida: no se dispara contra vallas ni se sale.
//  · Tiempo de vuelta propio por bot y bandera azul.
// ============================================================

// Paleta EXACTA pedida (los bots toman los 7 colores que no uses)
export const EXACT_PALETTE = {
  'Rojo':    '#e10600',
  'Azul':    '#0066ff',
  'Verde':   '#00b85c',
  'Amarillo':'#ffd400',
  'Rosa':    '#ff4fa3',
  'Morado':  '#9b30ff',
  'Naranja': '#ff7b00',
  'Blanco':  '#f2f2f2',
};
export const PALETTE_NAMES = Object.keys(EXACT_PALETTE);

// Perfiles de dificultad: solo cambian AGRESIVIDAD, no la física
const PROFILES = {
  easy:   { corner: 0.85, drs: false, errP: 0.020, defend: 0.1 },
  medium: { corner: 0.95, drs: false, errP: 0.008, defend: 0.4 },
  hard:   { corner: 1.00, drs: true,  errP: 0.003, defend: 0.8 },
};

// Nombres INVENTADOS (nada de pilotos/competiciones reales)
const BOT_NAMES = ['VOLT', 'KAI', 'ROX', 'ZEN', 'MILO', 'NEO', 'TARO', 'LYNX', 'RUDY', 'AXEL'];
const TAGS = { VOLT: 'VLT', KAI: 'KAI', ROX: 'ROX', ZEN: 'ZEN', MILO: 'MIL', NEO: 'NEO', TARO: 'TAR', LYNX: 'LYX', RUDY: 'RUD', AXEL: 'AXL' };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- OBB del coche (~4.6 x 1.9 m con alerones) + respuesta con impulso ----
const CAR_HX = 0.95;
const CAR_HZ = 2.3;

function obbAxes(h) {
  return [
    [-Math.sin(h), -Math.cos(h)],   // forward
    [Math.cos(h), -Math.sin(h)],    // right
  ];
}

function obbOverlap(ax, az, aH, bx, bz, bH) {
  const A = obbAxes(aH), B = obbAxes(bH);
  const dx = bx - ax, dz = bz - az;
  let bestDepth = Infinity, bestAxis = null;
  for (const axis of [A[0], A[1], B[0], B[1]]) {
    const proj = Math.abs(dx * axis[0] + dz * axis[1]);
    const ra = CAR_HZ * Math.abs(A[0][0] * axis[0] + A[0][1] * axis[1]) + CAR_HX * Math.abs(A[1][0] * axis[0] + A[1][1] * axis[1]);
    const rb = CAR_HZ * Math.abs(B[0][0] * axis[0] + B[0][1] * axis[1]) + CAR_HX * Math.abs(B[1][0] * axis[0] + B[1][1] * axis[1]);
    if (proj > ra + rb) return null;
    const depth = ra + rb - proj;
    if (depth < bestDepth) { bestDepth = depth; bestAxis = axis; }
  }
  const sgn = Math.sign(dx * bestAxis[0] + dz * bestAxis[1]) || 1;
  return { nx: bestAxis[0] * sgn, nz: bestAxis[1] * sgn, depth: bestDepth };
}

export class Race {
  constructor(scene, track, opts) {
    this.scene = scene;
    this.track = track;
    this.profile = PROFILES[opts.difficulty] || PROFILES.medium;
    this.difficulty = opts.difficulty;
    this.rnd = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

    this.phase = 'countdown';
    this.lights = 0;
    this.lightsT = 0;
    this.lightsHold = 0;
    this.allOn = false;
    this.jumpStart = false;

    // Parrilla barajada (rastreamos el hueco original para saber tu P#)
    const slots = [...(track.gridSlots || [])].map((s, i) => ({ s, i }));
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.playerStart = { pos: slots[0].s.pos.clone(), heading: slots[0].s.heading };
    this.playerGridPos = slots[0].i + 1;

    // Colores: la paleta exacta menos tu color, barajada; 7 bots, 7 colores
    const myColor = (opts.playerColor || '').toLowerCase();
    const pool = PALETTE_NAMES.filter((n) => EXACT_PALETTE[n].toLowerCase() !== myColor);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const names = [...BOT_NAMES];

    this.bots = [];
    const N = Math.min(7, slots.length - 1);
    for (let i = 0; i < N; i++) {
      const slot = slots[i + 1].s;
      const gridPos = slots[i + 1].i + 1;
      const r = this.rnd;
      // ---- CEREBRO PROPIO ----
      const brain = {
        // Punto de frenada: cada uno frena distinto (0.82 = muy pronto, 1.0 tarde)
        brakeMark: 0.84 + r() * 0.18,
        // Cuánto aprieta la trazada hacia el apex (0 = por el centro)
        apex: 0.35 + r() * 0.6,
        // Ritmo en curva propio (multiplicador de vCorner)
        corner: this.profile.corner * (0.94 + r() * 0.1),
        // Línea de adelantamiento preferida: +1 por dentro, -1 por fuera
        side: r() < 0.5 ? 1 : -1,
        // Agresividad al defender la trazada
        defend: this.profile.defend * (0.5 + r() * 0.8),
        // Error propio (fase y probabilidad desincronizadas)
        errPhase: r() * Math.PI * 2,
        errRate: 0.35 + r() * 0.65,
        // Movimiento lateral wobble desincronizado
        wob: r() * Math.PI * 2,
        wobF: 0.6 + r() * 0.7,
        // Ligeras diferencias de ritmo en recta (simula slipstream/fiat)
        vBias: 0.985 + r() * 0.025,
      };
      const nm = names.splice(Math.floor(r() * names.length), 1)[0] || 'BOT';
      this.bots.push({
        tag: TAGS[nm] || 'BOT',
        name: nm,
        gridPos,
        color: EXACT_PALETTE[pool[i % pool.length]],
        pos: slot.pos.clone(),
        heading: slot.heading,
        v: 0, u: this.track.arcOf(slot.pos.x, slot.pos.z),
        lap: 0, lastU: null, steer: 0,
        drs: false, drsUsed: false,
        finishTime: null,
        bestLap: null,
        lapStart: null,
        lapInvalid: false,
        prevSide: 0,
        brain,
        // Estado de daño por golpes
        dmgFront: 0,
        vLossPerm: 0,
      });
    }
    for (const b of this.bots) b.lastU = b.u;

    this._buildMeshes(opts.playerBodyGeo);
    this.playerProgress = { u: this.track.arcOf(this.playerStart.pos.x, this.playerStart.pos.z), laps: 0, lastU: null };
  }

  _buildMeshes(playerBodyGeo) {
    const group = new THREE.Group();
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    for (const b of this.bots) {
      const carGroup = new THREE.Group();
      const col = new THREE.Color(b.color);
      if (playerBodyGeo) {
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, color: col, roughness: 0.36, metalness: 0.18 });
        const body = new THREE.Mesh(playerBodyGeo, mat);
        body.castShadow = true;
        carGroup.add(body);
        b.bodyMat = mat;
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 2.4), mat);
        body.position.y = 0.22;
        carGroup.add(body);
      }
      const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1111, emissiveIntensity: 0.05 });
      const brakeLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), brakeMat);
      brakeLight.position.set(0, 0.22, 1.46);
      carGroup.add(brakeLight);
      b.brakeMat = brakeMat;
      // Etiqueta flotante: SOLO tag + cinta del color del coche (sin plataformas)
      {
        const cv = document.createElement('canvas');
        cv.width = 96; cv.height = 28;
        const c2 = cv.getContext('2d');
        c2.fillStyle = b.color;
        c2.fillRect(0, 0, 4, 28);
        c2.fillStyle = 'rgba(8,12,18,.78)';
        c2.fillRect(4, 0, 92, 28);
        c2.fillStyle = '#fff';
        c2.font = 'bold 17px monospace';
        c2.textAlign = 'center';
        c2.textBaseline = 'middle';
        c2.fillText(b.tag, 50, 15);
        const tex = new THREE.CanvasTexture(cv);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
        spr.scale.set(1.35, 0.39, 1);
        spr.position.set(0, 1.15, 0);
        spr.renderOrder = 5;
        carGroup.add(spr);
        b.tagSprite = spr;
      }
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.015, 0.2), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
      flap.position.set(0, 0.36, 1.4);
      carGroup.add(flap);
      b.drsFlap = flap;
      const tireGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.22, 24);
      tireGeo.rotateZ(Math.PI / 2);
      b.wheels = [];
      for (const [wx, wz] of [[-0.44, -0.93], [0.44, -0.93], [-0.44, 1.07], [0.44, 1.07]]) {
        const w = new THREE.Mesh(tireGeo, tireMat);
        w.position.set(wx, 0.155, wz);
        carGroup.add(w);
        b.wheels.push(w);
      }
      carGroup.position.copy(b.pos);
      carGroup.rotation.y = b.heading;
      b.mesh = carGroup;
      group.add(carGroup);
    }
    this.scene.add(group);
    this.group = group;
  }

  updateLights(dt) {
    if (this.phase !== 'countdown') return;
    if (!this.allOn) {
      this.lightsT += dt;
      if (this.lightsT >= 1) {
        this.lightsT = 0;
        this.lights++;
        if (typeof this.onLight === 'function') this.onLight(this.lights);
        if (this.lights >= 5) { this.allOn = true; this.lightsHold = 3 + this.rnd() * 2; }
      }
    } else {
      this.lightsHold -= dt;
      if (this.lightsHold <= 0) this.phase = 'green';
    }
  }

  stepBots(dt, player, P, audio) {
    if (this.phase === 'countdown') { for (const b of this.bots) b.v = 0; return; }
    const trk = this.track;
    const L = trk.trackLen();
    const n = trk.centers.length;

    for (const b of this.bots) {
      const br = b.brain;
      // Superficie
      const inf = trk.info(b.pos.x, b.pos.z);
      const offTrack = Math.abs(inf.lat) > trk.roadHalf + trk.kerbW * 0.6;
      const inSand = offTrack && trk.isSand(b.pos.x, b.pos.z);
      const grip = inSand ? P.sandMul : (offTrack ? P.grassMul : 1);

      // ---- Dirección: trazada personal (apex propio) + wobble propio ----
      const ahead = 6 + b.v * 0.55;
      const targetU = (b.u + ahead / L) % 1;
      const idx = Math.round((((targetU % 1) + 1) % 1) * n) % n;
      const curvSide = trk._turnSide[idx] || 0;
      // apex>0 tira hacia el interior de la curva que llega
      const lineLat = -curvSide * 3.2 * br.apex;
      const wob = Math.sin(performance.now() / 1000 * br.wobF + br.wob) * 1.1;
      const tp = trk.posAtArc(targetU, lineLat + wob);

      const dx = tp.x - b.pos.x, dz = tp.z - b.pos.z;
      const desired = Math.atan2(-dx, -dz);
      let dA = desired - b.heading;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      b.steer += THREE.MathUtils.clamp(THREE.MathUtils.clamp(dA * 2.2, -1, 1) - b.steer, -4.5 * dt, 4.5 * dt);

      // ---- DRS (solo perfil hard) ----
      const inZone = trk.isDrsZone(b.pos.x, b.pos.z);
      if (this.profile.drs && inZone) { b.drs = true; b.drsUsed = false; }
      else if (b.drs && !inZone) { b.drs = false; b.drsUsed = true; }

      // ---- Velocidad objetivo con CEREBRO propio ----
      const vAbs = Math.max(b.v, 0);
      const R = Math.max(trk._radii[idx], 12);
      const latMax = (P.latBase + P.latQ * vAbs * vAbs) * grip;
      let vTarget = Math.min(95 * br.vBias - b.vLossPerm, Math.sqrt(latMax * br.corner * R));
      // Error HUMANO propio (no sincronizado): llega pasado y frena más
      b.brain.errPhase += dt * br.errRate;
      if (Math.sin(br.errPhase * 2.3) > 0.992 - this.profile.errP) vTarget *= 0.88;
      if (b.drs) vTarget = Math.min(322 / 3.6, vTarget * 1.07);

      // ---- Longitudinal (misma física que el jugador) ----
      let a = 0;
      if (b.v < vTarget - 0.3) {
        let F = Math.min(P.powerW / Math.max(b.v, 8), P.tractionCap * grip);
        if (b.drs) F += P.drsPush * Math.max(0, 1 - b.v / P.drsPushV);
        a = F / P.mass;
        a = Math.min(a, (vTarget - b.v) / dt);
      } else if (b.v > vTarget + 0.5) {
        const bd = offTrack
          ? Math.min((P.brakeBase + P.brakeQ * b.v * b.v) * grip, 9)
          : (P.brakeBase + P.brakeQ * b.v * b.v) * br.brakeMark;
        a = -Math.min(bd, (b.v - vTarget) / dt + 2);
      } else {
        a = -Math.sign(b.v) * Math.min(P.coastDecel, Math.abs(b.v) / dt);
      }
      if (inSand && vAbs > 0.3) a -= Math.sign(b.v) * Math.min(P.sandDrag, vAbs / dt);
      a -= (Math.sign(b.v) * 0.5 * P.rho * P.CdA * b.v * b.v * (b.drs ? P.drsDragMul : 1)) / P.mass;
      b.v = Math.max(0, b.v + a * dt);

      // ---- Giro (misma cinemática) ----
      const delta = b.steer * P.maxSteer * Math.exp(-b.v / P.steerFadeV);
      const steerOmega = (b.v * Math.tan(delta)) / P.wheelbase;
      const maxLat = (P.latBase + P.latQ * b.v * b.v) * grip;
      const gripOmega = (Math.sign(steerOmega) * maxLat) / Math.max(b.v, 0.1);
      const omega = Math.abs(steerOmega) > Math.abs(gripOmega) ? gripOmega : steerOmega;
      b.heading += omega * dt;
      const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
      b.pos.x += fx * b.v * dt;
      b.pos.z += fz * b.v * dt;

      // ---- ANTI-SUICIDA: empuje suave hacia el eje si se acerca al borde ----
      const inf2 = trk.info(b.pos.x, b.pos.z);
      const lim = trk.roadHalf + trk.kerbW * 0.5;
      if (Math.abs(inf2.lat) > lim - 1.2) {
        const pull = 9 * dt * (Math.abs(inf2.lat) - (lim - 1.2));
        b.pos.x -= inf2.nx * pull * Math.sign(inf2.lat);
        b.pos.z -= inf2.nz * pull * Math.sign(inf2.lat);
        b.v = Math.max(0, b.v - 4 * dt);
      }
      // Colisión con valla (como el jugador) por si el empuje no basta
      const cols = trk.collideFence(b.pos.x, b.pos.z);
      if (cols.length) {
        let deepest = cols[0];
        for (const c of cols) if (c.depth > deepest.depth) deepest = c;
        b.pos.x += deepest.n.x * deepest.depth;
        b.pos.z += deepest.n.z * deepest.depth;
        const fx2 = -Math.sin(b.heading), fz2 = -Math.cos(b.heading);
        const vn = fx2 * deepest.n.x + fz2 * deepest.n.z;
        if (vn < 0) { b.v = Math.max(0, b.v + vn * 1.2); if (audio) audio.crash(0.4); }
      }

      // ---- Vuelta y tiempo propio ----
      const u = trk.arcOf(b.pos.x, b.pos.z);
      const side = Math.sign(((b.pos.x - trk.startPos.x) * trk.startTangent.x + (b.pos.z - trk.startPos.z) * trk.startTangent.z)) || 0;
      if (b.prevSide < 0 && side >= 0) {
        if (b.lapStart == null) b.lapStart = performance.now(); // salida
        else {
          const t = performance.now() - b.lapStart;
          if (!b.lapInvalid) {
            b.lastLap = t;
            if (b.bestLap == null || t < b.bestLap) b.bestLap = t;
          }
          b.lapInvalid = false;
          b.lapStart = performance.now();
        }
        b.lap++;
      } else if (b.prevSide > 0 && side <= 0) {
        b.lapInvalid = true;
      }
      b.prevSide = side;
      b.lastU = b.u; b.u = u;

      // ---- Visual ----
      b.mesh.position.set(b.pos.x, 0, b.pos.z);
      b.mesh.rotation.y = b.heading;
      b.mesh.rotation.z = 0; // sin roll permanente (el toque se recupera)
      const spin = (b.v / 0.16) * dt;
      for (const w of b.wheels) w.rotation.x -= spin;
      b.drsFlap.rotation.x = b.drs ? -0.95 : 0;
      b.brakeMat.emissiveIntensity = a < -8 ? 2.4 : 0.05;
    }

    // ---- Colisiones con IMPULSO + daño (bots entre sí y con el jugador) ----
    this._collisions(player, audio);
  }

  _collisions(player, audio) {
    const all = [
      { isPlayer: true, pos: player.pos, heading: player.heading, vx: player.vx, mesh: null },
      ...this.bots,
    ];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i], B = all[j];
        const dx0 = B.pos.x - A.pos.x, dz0 = B.pos.z - A.pos.z;
        if (dx0 * dx0 + dz0 * dz0 > 42) continue;
        const hit = obbOverlap(A.pos.x, A.pos.z, A.heading, B.pos.x, B.pos.z, B.heading);
        if (!hit) continue;
        const depth = hit.depth;
        // Separación 50/50
        const push = depth / 2 + 0.005;
        A.pos.x -= hit.nx * push; A.pos.z -= hit.nz * push;
        B.pos.x += hit.nx * push; B.pos.z += hit.nz * push;

        // Velocidades de aproximación a lo largo de la normal
        const fA = { x: -Math.sin(A.heading), z: -Math.cos(A.heading) };
        const fB = { x: -Math.sin(B.heading), z: -Math.cos(B.heading) };
        const vA = A.isPlayer ? (player.vx || 0) : A.v;
        const vB = B.isPlayer ? (player.vx || 0) : B.v;
        const sA = vA * (fA[0] * hit.nx + fA[1] * hit.nz);   // velocidad de A hacia la normal
        const sB = vB * (fB[0] * hit.nx + fB[1] * hit.nz);
        // Impulso 1D: intercambio con restitución 0.25 (choque semi-inelástico)
        const rel = sA - sB;
        if (rel > 0.5) {
          const rest = 0.25;
          const jImp = (1 + rest) * rel / 2;
          const impact = Math.min(1, rel / 30);
          if (!A.isPlayer) {
            A.v = Math.max(0, A.v - jImp * Math.abs(fA[0] * hit.nx + fA[1] * hit.nz));
            // Rotación por toque: el golpe lateral desvía la trazada
            const lateral = 1 - Math.abs(fA[0] * hit.nx + fA[1] * hit.nz);
            A.heading += (hit.nz * fA[0] - hit.nx * fA[1]) * lateral * impact * 0.12;
            A.dmgFront = Math.min(1, A.dmgFront + impact * 0.5);
            A.vLossPerm = Math.min(6, A.vLossPerm + impact * 0.8);
          }
          if (!B.isPlayer) {
            B.v = Math.max(0, B.v - jImp * Math.abs(fB[0] * hit.nx + fB[1] * hit.nz));
            const lateral = 1 - Math.abs(fB[0] * hit.nx + fB[1] * hit.nz);
            B.heading += -(hit.nz * fB[0] - hit.nx * fB[1]) * lateral * impact * 0.12;
            B.dmgFront = Math.min(1, B.dmgFront + impact * 0.5);
            B.vLossPerm = Math.min(6, B.vLossPerm + impact * 0.8);
          }
          // El jugador: pierde velocidad según el ángulo del impacto
          const latP = 1 - Math.abs(fA[0] * hit.nx + fA[1] * hit.nz);
          player.vx = Math.max(0, (player.vx || 0) - jImp * (0.6 + latP * 0.6));
          if (typeof this.onPlayerHit === 'function') this.onPlayerHit(impact, hit);
          if (audio && impact > 0.06) audio.crash(0.3 + impact);
        }
      }
    }
  }

  updatePlayerProgress(x, z) {
    const p = this.playerProgress;
    const u = this.track.arcOf(x, z);
    if (p.lastU > 0.8 && u < 0.2) p.laps++;
    p.lastU = u;
    p.u = u;
  }

  liveStandings(playerName, playerColor, playerFinished, playerLaps) {
    const rows = [
      { name: playerName, tag: this._tagOf(playerName), color: playerColor, prog: this.playerProgress.u, laps: playerLaps, isPlayer: true, finishTime: playerFinished ? (this.playerFinishTime || 0) : null, bestLap: this.playerBestLap || null },
    ];
    for (const b of this.bots) {
      rows.push({ name: b.tag, tag: b.tag, color: b.color, prog: b.u, laps: b.lap, isPlayer: false, finishTime: b.finishTime, bestLap: b.bestLap });
    }
    rows.sort((a, b) => {
      if (a.finishTime != null && b.finishTime != null) return a.finishTime - b.finishTime;
      if (a.finishTime != null) return -1;
      if (b.finishTime != null) return 1;
      if (b.laps !== a.laps) return b.laps - a.laps;
      return b.prog - a.prog;
    });
    return rows;
  }

  _tagOf(name) {
    const t = (name || 'PIL').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return (t.slice(0, 3) || 'PIL');
  }

  isFinished() { return this.bots.every((b) => b.finishTime != null); }
  finishPlayer(timeMs) { this.playerFinishTime = timeMs; }

  dispose() {
    if (this.group) this.scene.remove(this.group);
  }
}
