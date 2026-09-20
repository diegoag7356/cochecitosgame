import * as THREE from 'three';

// ---- Constantes del entorno exterior ----
const SAND_W = 14;        // anchura de la banda de arena
const BARRIER_OFF = 25;   // distancia de la barrera al eje: asfalto(8) + kerb(1) + arena(14) + 2
const WALL_H = 1.0;       // muro gris: altura del coche
const MESH_H = 4.2;       // verja alta sobre el muro
const CAR_R = 1.1;        // radio de colisión del coche contra la barrera
const BLDG_OFF = 41;      // distancia de los edificios al eje (valla 25 + 16)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mergeGeos_(geos) {
  const pos = [], norm = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const gg = g.index ? g.toNonIndexed() : g;
    const p = gg.getAttribute('position'), nn = gg.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(nn ? nn.getX(i) : 0, nn ? nn.getY(i) : 1, nn ? nn.getZ(i) : 0);
    }
    for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setIndex(idx);
  return out;
}

export class Track {
  constructor(scene) {
    this.scene = scene;

    const TRACK_SCALE = 4; // lleva el perímetro a ~4318 m reales
    this.width = 16;          // ancho real de asfalto del Circuito Aurora
    this.curbWidth = 1;
    this.curbSegmentLength = 2;
    this.segments = 2000;

    const rawPoints = [
      new THREE.Vector3(34, 0, 165),
      new THREE.Vector3(-56, 0, 100),
      new THREE.Vector3(-146, 0, 35),
      new THREE.Vector3(-103, 0, -63),
      new THREE.Vector3(34, 0, -112),
      new THREE.Vector3(1, 0, -58),
      new THREE.Vector3(-99, 0, 2),
      new THREE.Vector3(-18, 0, 75),
      new THREE.Vector3(4, 0, 2),
      new THREE.Vector3(94, 0, -40),
      new THREE.Vector3(184, 0, -82),
      new THREE.Vector3(244, 0, -17),
      new THREE.Vector3(139, 0, 74),
    ];

    this.points = rawPoints.map(p => p.clone().multiplyScalar(TRACK_SCALE));
    this.curve = new THREE.CatmullRomCurve3(this.points, true, 'catmullrom', 0.4);

    // --- API del juego ---
    this.roadHalf = this.width / 2;
    this.kerbW = this.curbWidth;
    const N = 1600;
    this.centers = this.curve.getPoints(N);
    this.computeCurvature();
    this.buildDrsZone();
    this.buildStart();

    this.buildGround();
    this.buildRoad();
    this.buildCurbs();
    this.buildStartLine();
    this.buildGrid();
    this.buildSand();
    this.buildBarrier();
    this.buildBuildings();
    this.buildSectorSigns();
  }

  // Carteles 3D de sectores (S2 y S3; la meta ya tiene su línea) a mitad de
  // camino entre el asfalto y la barrera, de cara al tráfico que llega.
  buildSectorSigns() {
    const mkTexture = (num) => {
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 160;
      const c = cvs.getContext('2d');
      c.fillStyle = '#0d1b33';
      c.fillRect(0, 0, 512, 160);
      c.strokeStyle = '#3f7fd4';
      c.lineWidth = 10;
      c.strokeRect(8, 8, 496, 144);
      c.fillStyle = '#ffffff';
      c.font = '900 88px Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('SECTOR ' + num, 256, 84);
      return new THREE.CanvasTexture(cvs);
    };
    const startU = this.arcOf(this.startPos.x, this.startPos.z);
    for (let s = 2; s <= 3; s++) {
      const u = (startU + (s - 1) / 3) % 1;
      const p = this.posAtArc(u, 13.5);
      const g = new THREE.Group();
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 1.9),
        new THREE.MeshBasicMaterial({ map: mkTexture(s), side: THREE.DoubleSide })
      );
      panel.position.y = 3.2;
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x5b636b });
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8);
      const p1 = new THREE.Mesh(poleGeo, poleMat); p1.position.set(-2.6, 1.6, 0);
      const p2 = new THREE.Mesh(poleGeo, poleMat); p2.position.set(2.6, 1.6, 0);
      g.add(panel, p1, p2);
      g.position.set(p.x, 0, p.z);
      // La cara del cartel (+Z) mira en contra de la marcha: lo ve quien llega
      g.rotation.y = p.heading;
      this.scene.add(g);
    }
  }

  // Posición lateral firmada respecto al eje de la pista (0 en el centro,
  // + hacia la izquierda de la marcha). La usa la física para hierba/arena/DRS.
  info(x, z) {
    const C = this.centers;
    const n = C.length;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i += 4) {
      const dx = x - C[i].x, dz = z - C[i].z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    let lat = 0, nx = 0, nz = 0, qx = 0, qz = 0;
    bd = Infinity;
    for (let k = -4; k <= 4; k++) {
      const i0 = (best + k + n) % n, i1 = (i0 + 1) % n;
      const ax = C[i0].x, az = C[i0].z;
      const bx = C[i1].x - ax, bz = C[i1].z - az;
      const len2 = bx * bx + bz * bz;
      if (len2 < 1e-9) continue;
      const t = THREE.MathUtils.clamp(((x - ax) * bx + (z - az) * bz) / len2, 0, 1);
      const px = ax + bx * t, pz = az + bz * t;
      const dx = x - px, dz = z - pz;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        const il = 1 / Math.sqrt(len2);
        const tx = bx * il, tz = bz * il;
        nx = -tz; nz = tx;
        lat = dx * nx + dz * nz;
        qx = px; qz = pz;
      }
    }
    return { lat, nx, nz, px: qx, pz: qz };
  }

  // Empuja un punto hacia fuera del trazado hasta estar a 'dist' del punto
  // del eje más cercano. Con esto la barrera y los edificios nunca cruzan la
  // carretera aunque el circuito se acerque a sí mismo (esses, horquillas).
  pushOut(x, z, dist) {
    const inf = this.info(x, z);
    const dx = x - inf.px, dz = z - inf.pz;
    const d = Math.hypot(dx, dz);
    // Solo empuja si el punto está DEMASIADO CERCA del trazado. Antes se
    // re-colocaba siempre a distancia exacta y, en curvas cerradas, eso
    // lanzaba barreras y edificios al otro lado de la pista.
    if (d >= dist) return { x, z };
    const dd = d || 1e-6;
    return { x: inf.px + (dx / dd) * dist, z: inf.pz + (dz / dd) * dist };
  }

  // Radio de curvatura local suavizado + lado del giro en cada punto del eje.
  // Si el offset interior de la barrera supera el radio, la polilínea de
  // barrera se invierte y cruza el asfalto (lo que se veía en T1 y en la
  // horquilla tras la recta trasera).
  computeCurvature() {
    const C = this.centers, n = C.length;
    const rawR = new Float64Array(n), rawS = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p0 = C[(i - 1 + n) % n], p1 = C[i], p2 = C[(i + 1) % n];
      const d1x = p1.x - p0.x, d1z = p1.z - p0.z;
      const d2x = p2.x - p1.x, d2z = p2.z - p1.z;
      const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
      const dot = (d1x * d2x + d1z * d2z) / ((l1 * l2) || 1);
      const dth = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
      rawR[i] = dth > 1e-6 ? (l1 + l2) / 2 / dth : 1e9;
      // giro a la derecha (hacia el lado +1) => cross_z > 0
      rawS[i] = Math.sign(d1x * d2z - d1z * d2x);
    }
    this._radii = new Float64Array(n);
    this._turnSide = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      let m = Infinity, sum = 0;
      for (let k = -3; k <= 3; k++) {
        const j = (i + k + n) % n;
        if (rawR[j] < m) m = rawR[j];
        sum += rawS[j];
      }
      this._radii[i] = m;
      this._turnSide[i] = sum > 0 ? 1 : (sum < 0 ? -1 : 0);
    }
  }

  // Offset de la barrera en el punto i del eje para un lado dado: en el
  // interior de una curva cerrada se acerca a la pista (offset ≤ radio),
  // como los muros reales; así nunca se envuelve y cruza el asfalto.
  barrierOffsetAt(i, side) {
    if (this._turnSide[i] === side) {
      return Math.max(11.5, Math.min(BARRIER_OFF, this._radii[i] - 2));
    }
    return BARRIER_OFF;
  }

  // Zonas DRS:
  //   1. Recta de meta: desde T10 hasta casi T1
  //   2. Recta trasera: entre T4 y T5
  buildDrsZone() {
    const C = this.centers, n = C.length;
    const idxOf = (p) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = C[i].distanceToSquared(p);
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    };
    const stretch = (iStart, iEnd, shrinkStart, shrinkEnd) => {
      const span = (iEnd - iStart + n) % n;
      const pts = [];
      for (let k = shrinkStart; k < span - shrinkEnd; k++) pts.push(C[(iStart + k) % n]);
      return pts;
    };
    const iStartMain = idxOf(this.points[11]);
    const iEndMain = idxOf(this.points[0]);
    const mainZone = stretch(iStartMain, iEndMain, 8, 22);
    const iStartBack = idxOf(this.points[3]);
    const iEndBack = idxOf(this.points[4]);
    const backZone = stretch(iStartBack, iEndBack, 14, 20);
    this.drsPts = [...mainZone, ...backZone];
    this.drsZones = [mainZone, backZone];
    // Rangos de ARCO [uInicio, uFin] de cada zona: la pertenencia se decide
    // por progresión longitudinal, no por un corredor central — puedes abrirte
    // para adelantar y el DRS sigue activo.
    this.drsRanges = [];
    for (const zone of [mainZone, backZone]) {
      if (zone.length < 2) continue;
      const u0 = this.arcOf(zone[0].x, zone[0].z);
      let u1 = this.arcOf(zone[zone.length - 1].x, zone[zone.length - 1].z);
      if (u1 < u0) u1 += 1; // zona que cruza el 0
      this.drsRanges.push([u0, u1]);
    }
  }

  isDrsZone(x, z) {
    const u = this.arcOf(x, z);
    for (const [a, b] of this.drsRanges) {
      if (a <= b ? (u >= a && u <= b) : (u >= a || u <= b)) return true;
    }
    return false;
  }

  // Salida en la recta de meta, mirando hacia T1 (orden de circulación)
  buildStart() {
    const C = this.centers, n = C.length;
    let i12 = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = C[i].distanceToSquared(this.points[12]);
      if (d < bd) { bd = d; i12 = i; }
    }
    const p = C[i12 % n], ahead = C[(i12 + 10) % n];
    this.startPos = new THREE.Vector3(p.x, 0, p.z);
    const dir = new THREE.Vector3(ahead.x - p.x, 0, ahead.z - p.z).normalize();
    this.startHeading = Math.atan2(-dir.x, -dir.z);
    this.startTangent = dir;
  }

  // Parrilla de salida: 8 huecos escalonados detrás de la línea de meta,
  // con las marcas típicas de F1 pintadas en el asfalto.
  buildGrid() {
    const p = this.startPos, tg = this.startTangent;
    const nlx = -tg.z, nlz = tg.x;
    this.gridSlots = [];
    const verts = [], colors = [], idx = [];
    let vi = 0;
    const white = [0.92, 0.92, 0.92];
    const pushQuad = (c, fx, fz, lx, lz, lon0, lon1, lat0, lat1) => {
      const cs = [
        [c.x + fx * lon0 + lx * lat0, c.z + fz * lon0 + lz * lat0],
        [c.x + fx * lon0 + lx * lat1, c.z + fz * lon0 + lz * lat1],
        [c.x + fx * lon1 + lx * lat0, c.z + fz * lon1 + lz * lat0],
        [c.x + fx * lon1 + lx * lat1, c.z + fz * lon1 + lz * lat1],
      ];
      for (const [x, z] of cs) { verts.push(x, 0.025, z); colors.push(...white); }
      idx.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
      vi += 4;
    };
    for (let k = 0; k < 8; k++) {
      const lon = -(8 + 8 * k);
      const lat = (k % 2 === 0 ? 3.4 : -3.4);
      const pos = new THREE.Vector3(
        p.x + tg.x * lon + nlx * lat, 0,
        p.z + tg.z * lon + nlz * lat
      );
      this.gridSlots.push({ pos, heading: this.startHeading });
      // Marcas: barra trasera + dos laterales en "L" abierta hacia delante
      const fx = -Math.sin(this.startHeading), fz = -Math.cos(this.startHeading);
      const lx = -fz, lz = fx;
      pushQuad(pos, fx, fz, lx, lz, -0.55, -0.2, -0.8, 0.8);   // barra trasera
      pushQuad(pos, fx, fz, lx, lz, -0.2, 1.7, 0.8, 0.95);     // lateral izq
      pushQuad(pos, fx, fz, lx, lz, -0.2, 1.7, -0.95, -0.8);   // lateral der
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // Bandas de arena en las salidas de las curvas clave (escapadas de verdad)
  buildSand() {
    const C = this.centers, n = C.length;
    const near = (p) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = C[i].distanceToSquared(p);
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    };
    const zoneDefs = [
      [near(this.points[0]), 30],
      [near(this.points[2]), 26],
      [near(this.points[3]), 24],
      [near(this.points[6]), 22],
      [near(this.points[8]), 24],
      [near(this.points[10]), 26],
    ];
    this._sandZones = zoneDefs;
    const geoOut = [];
    for (const [ic, half] of zoneDefs) {
      for (let k = -half; k <= half; k++) {
        const i0 = (ic + k + n) % n, i1 = (ic + k + 1 + n) % n;
        for (const side of [1, -1]) {
          const a = C[i0], b = C[i1];
          const tx = b.x - a.x, tz = b.z - a.z;
          const il = 1 / (Math.hypot(tx, tz) || 1);
          const nx = -tz * il * side, nz = tx * il * side;
          const off = this.roadHalf + this.kerbW;
          const A0 = { x: a.x + nx * off, z: a.z + nz * off };
          const B0 = { x: a.x + nx * (off + SAND_W), z: a.z + nz * (off + SAND_W) };
          const A1 = { x: b.x + nx * off, z: b.z + nz * off };
          const B1 = { x: b.x + nx * (off + SAND_W), z: b.z + nz * (off + SAND_W) };
          geoOut.push(A0.x, 0.02, A0.z, B0.x, 0.02, B0.z, A1.x, 0.02, A1.z, B1.x, 0.02, B1.z);
        }
      }
    }
    const mk = (flat, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
      const idx = [];
      const quads = flat.length / 12;
      for (let q = 0; q < quads; q++) {
        const v = q * 4;
        idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      this.scene.add(m);
      return m;
    };
    mk(geoOut, new THREE.MeshLambertMaterial({ color: 0xd8b56a, side: THREE.DoubleSide }));
  }

  // Distancia² de un punto al segmento p-q (helper para el anti-cruce)
  pointSegDist2(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return (px - ax) ** 2 + (pz - az) ** 2;
    const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
    return (px - (ax + dx * t)) ** 2 + (pz - (az + dz * t)) ** 2;
  }

  // ---- Utilidades de progresión para IA y leaderboard ----
  // Longitud de la polilínea del eje (la misma que usa info() para lat/lon).
  trackLen() {
    if (this._len != null) return this._len;
    const C = this.centers, n = C.length;
    let L = 0;
    for (let i = 0; i < n; i++) {
      const a = C[i], b = C[(i + 1) % n];
      L += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this._len = L;
    return L;
  }

  // Progresión longitudinal [0..1) del punto más cercano al eje.
  // Búsqueda en dos fases (paso grueso + refinado) para ser barata: se llama
  // por subpaso de física en todos los coches.
  arcOf(x, z) {
    const C = this.centers, n = C.length;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i += 6) {
      const dx = x - C[i].x, dz = z - C[i].z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const lo = (best - 6 + n) % n, hi = (best + 6) % n;
    for (let i = lo; ; i = (i + 1) % n) {
      const dx = x - C[i].x, dz = z - C[i].z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
      if (i === hi) break;
    }
    return best / n;
  }

  // Posición y rumbo en la progresión u [0..1), con offset lateral.
  posAtArc(u, lat = 0) {
    const C = this.centers, n = C.length;
    const f = ((u % 1) + 1) % 1 * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    const x = C[i0].x + (C[i1].x - C[i0].x) * t;
    const z = C[i0].z + (C[i1].z - C[i0].z) * t;
    const tx = C[i1].x - C[i0].x, tz = C[i1].z - C[i0].z;
    const il = 1 / (Math.hypot(tx, tz) || 1);
    const ux = tx * il, uz = tz * il;
    const px = x + -uz * lat, pz = z + ux * lat;
    return { x: px, z: pz, heading: Math.atan2(-ux, -uz) };
  }

  // Distancia recorrida entre dos progresiones (adelante, con wrap).
  lapDist(uFrom, uTo) {
    return (((uTo - uFrom) % 1) + 1) % 1 * this.trackLen();
  }

  // ¿Está el punto en una banda de arena?
  isSand(x, z) {
    const inner = this.roadHalf + this.kerbW;
    for (const [ic, half] of this._sandZones) {
      const C = this.centers, n = C.length;
      for (let k = -half; k <= half; k += 2) {
        const p = C[(ic + k + n) % n];
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz > (SAND_W + 4) ** 2) continue;
        const i1 = (ic + k + 1 + n) % n;
        const tx = C[i1].x - p.x, tz = C[i1].z - p.z;
        const il = 1 / (Math.hypot(tx, tz) || 1);
        const nx = -tz * il, nz = tx * il;
        const lat = Math.abs(dx * nx + dz * nz);
        if (lat > inner && lat < inner + SAND_W) return true;
      }
    }
    return false;
  }

  // ---- Barrera continua alrededor de TODO el circuito (incluida arena) ----
  // Muro gris de la altura del coche + verja alta encima + postes cada ~27 m.
  // La colisión usa los segmentos base del anillo: no hay huecos ni túneles.
  buildBarrier() {
    const C = this.centers, n = C.length;
    // 1) Polilínea empujada por lado (con subdivisión en curvas fuertes)
    const strips = [];
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = C[i], b = C[(i + 1) % n];
        const tx = b.x - a.x, tz = b.z - a.z;
        const il = 1 / (Math.hypot(tx, tz) || 1);
        const nx = -tz * il * side, nz = tx * il * side;
        // Offset por punto: en curvas cerradas la barrera interior se acerca
        // (barrierOffsetAt) para que la polilínea nunca se invierta.
        const off0 = this.barrierOffsetAt(i, side);
        const off1 = this.barrierOffsetAt((i + 1) % n, side);
        const p0 = this.pushOut(a.x + nx * off0, a.z + nz * off0, BARRIER_OFF);
        const p1 = this.pushOut(b.x + nx * off1, b.z + nz * off1, BARRIER_OFF);
        // Anti-cruce: si el pushOut descoloca un extremo de la línea a-b
        // (curvatura fuerte), se subdivide en 4 sub-tramos con pushOut propio.
        const bad = this.pointSegDist2(p0.x, p0.z, a.x, a.z, b.x, b.z) > 0.36 ||
                    this.pointSegDist2(p1.x, p1.z, a.x, a.z, b.x, b.z) > 0.36;
        if (bad) {
          const steps = 4;
          for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
            const t = s / steps;
            const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
            pts.push(this.pushOut(cx + nx * off0, cz + nz * off0, BARRIER_OFF));
          }
        } else {
          if (i === 0) pts.push(p0);
          pts.push(p1);
        }
      }
      strips.push(pts);
    }
    // 2) Segmentos candidatos (anillo cerrado por lado)
    const segs = [];
    for (const pts of strips) {
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[(k + 1) % pts.length];
        segs.push([p.x, p.z, q.x, q.z]);
      }
    }
    // 3) Filtro global: NINGÚN punto del tramo (extremos y centro) puede
    // quedar a <10.5 m del eje (asfalto 8 + kerb 1 + margen). Garantía final:
    // la barrera jamás pisa la carretera.
    const good = segs.filter((s) => {
      const samples = [[s[0], s[1]], [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2], [s[2], s[3]]];
      for (const [x, z] of samples) {
        const inf = this.info(x, z);
        if (Math.hypot(x - inf.px, z - inf.pz) < 10.5) return false;
      }
      return true;
    });
    // 4) Visuales y colisión generados de los MISMOS segmentos
    const wallV = [], meshV = [], postV = [];
    this._barrierSegs = [];
    good.forEach((s, si) => {
      const [ax, az, bx, bz] = s;
      // Muro (0 .. WALL_H), doble cara para leerse desde dentro y fuera
      wallV.push(ax, 0, az, bx, 0, bz, ax, WALL_H, az, bx, WALL_H, bz);
      wallV.push(bx, 0, bz, ax, 0, az, bx, WALL_H, bz, ax, WALL_H, az);
      // Verja (WALL_H .. MESH_H)
      meshV.push(ax, WALL_H, az, bx, WALL_H, bz, ax, MESH_H, az, bx, MESH_H, bz);
      meshV.push(bx, WALL_H, bz, ax, WALL_H, az, bx, MESH_H, bz, ax, MESH_H, az);
      this._barrierSegs.push([ax, az, bx, bz, si]);
      // Postes cada 10 segmentos (~27 m)
      if (si % 10 === 0) {
        const dx = bx - ax, dz = bz - az, il2 = 1 / (Math.hypot(dx, dz) || 1);
        const ux = dx * il2, uz = dz * il2;
        postV.push(ax + ux * 0.14, 0, az + uz * 0.14, ax - ux * 0.14, 0, az - uz * 0.14,
                   ax + ux * 0.14, MESH_H + 0.2, az + uz * 0.14, ax - ux * 0.14, MESH_H + 0.2, az - uz * 0.14);
      }
    });
    const mk = (flat, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
      const idx = [];
      const quads = flat.length / 12;
      for (let q = 0; q < quads; q++) {
        const v = q * 4;
        idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      this.scene.add(m);
      return m;
    };
    mk(wallV, new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide }));
    mk(meshV, new THREE.MeshBasicMaterial({
      color: 0xcfd6dd, side: THREE.DoubleSide,
      transparent: true, opacity: 0.32, depthWrite: false,
    }));
    mk(postV, new THREE.MeshLambertMaterial({ color: 0x6b7178, side: THREE.DoubleSide }));
  }

  // Colisión contra la barrera: devuelve TODOS los segmentos a menos de CAR_R
  // (con margen extra de búsqueda para que a 320 km/h no haya túneles).
  collideFence(x, z) {
    if (!this._barrierGrid) {
      const grid = new Map();
      const cell = (cx, cz, seg) => {
        const key = cx + ',' + cz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(seg);
      };
      for (const seg of this._barrierSegs) {
        const [ax, az, bx, bz] = seg;
        const cx0 = Math.floor(Math.min(ax, bx) / 20), cx1 = Math.floor(Math.max(ax, bx) / 20);
        const cz0 = Math.floor(Math.min(az, bz) / 20), cz1 = Math.floor(Math.max(az, bz) / 20);
        for (let cx = cx0; cx <= cx1; cx++)
          for (let cz = cz0; cz <= cz1; cz++) cell(cx, cz, seg);
      }
      this._barrierGrid = grid;
    }
    const out = [];
    const R = CAR_R + 1.5; // margen: cubre el desplazamiento máximo por subpaso
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cands = this._barrierGrid.get((cx + i) + ',' + (cz + j));
        if (!cands) continue;
        for (const [ax, az, bx, bz, si] of cands) {
          const dx = bx - ax, dz = bz - az;
          const len2 = dx * dx + dz * dz;
          if (len2 < 1e-9) continue;
          let t = ((x - ax) * dx + (z - az) * dz) / len2;
          t = THREE.MathUtils.clamp(t, 0, 1);
          const px = ax + dx * t, pz = az + dz * t;
          const ex = x - px, ez = z - pz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= CAR_R * CAR_R) continue;
          const d = Math.sqrt(d2);
          let nx, nz;
          if (d > 1e-4) { nx = ex / d; nz = ez / d; }
          else {
            // Exactamente sobre el segmento: normal perpendicular orientada al lado del coche
            const il = 1 / Math.sqrt(len2);
            nx = -dz * il; nz = dx * il;
            const sgn = Math.sign((x - ax) * nx + (z - az) * nz) || 1;
            nx *= sgn; nz *= sgn;
          }
          out.push({ n: new THREE.Vector3(nx, 0, nz), depth: CAR_R - d, si });
        }
      }
    }
    return out;
  }

  // ---- Edificios en fila, pegados al exterior de las vallas ----
  // Grises con ventanas azules alineadas y pegadas a las fachadas; rodean
  // TODO el circuito (se desplazan con pushOut donde el trazado se acercar).
  buildBuildings() {
    const rnd = mulberry32(20260919);
    const C = this.centers, n = C.length;
    const wallGeos = [], winGeos = [];
    const step = 8; // un edificio cada 8 segmentos (~22 m) por lado
    for (let i = 0; i < n; i += step) {
      const a = C[i], b = C[(i + 1) % n];
      const tx = b.x - a.x, tz = b.z - a.z;
      const il = 1 / (Math.hypot(tx, tz) || 1);
      const ux = tx * il, uz = tz * il;
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = uz * side;
        const center = this.pushOut(a.x + nx * BLDG_OFF, a.z + nz * BLDG_OFF, BLDG_OFF);
        // Anti-cruce: si el centro quedó a <33 m del eje (trazado que se
        // acerca a sí mismo), el edificio se descarta: nada cruza la pista.
        const ci = this.info(center.x, center.z);
        if (Math.hypot(center.x - ci.px, center.z - ci.pz) < 33) continue;
        const bx = center.x, bz = center.z;
        const w = 14 + rnd() * 8;   // longitudinal (a lo largo de la pista)
        const dep = 10 + rnd() * 5; // hacia fuera
        const h = 22 + rnd() * 46;
        const yaw = Math.atan2(ux, uz); // eje local Z sigue la tangente de la pista
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        const place = (lx, ly, lz) => bx + lx * cos + lz * sin;
        const placeZ = (lx, ly, lz) => bz - lx * sin + lz * cos;
        // Cuerpo gris
        const g = new THREE.BoxGeometry(w, h, dep);
        g.rotateY(yaw);
        g.translate(bx, h / 2, bz);
        wallGeos.push(g);
        // Ventanas azules: rejilla en las 4 fachadas, pegadas (offset 0.08)
        const cellW = 2.2, cellH = 2.6;
        const cols = Math.max(3, Math.floor((w - 2.5) / cellW));
        const rows = Math.max(3, Math.floor((h - 6) / cellH));
        const winLong = new THREE.PlaneGeometry(cellW * 0.62, cellH * 0.55); // fachadas Z
        const winSide = new THREE.PlaneGeometry(cellW * 0.62, cellH * 0.55); // fachadas X
        for (let r = 0; r < rows; r++) {
          const ly = 4 + r * cellH + (h - 4 - rows * cellH) / 2;
          for (let c = 0; c < cols; c++) {
            const lx = -((cols - 1) * cellW) / 2 + c * cellW;      // columnas a lo largo (eje local X)
            const lz = -((cols - 1) * cellW) / 2 + c * cellW;      // columnas en profundidad (eje local Z)
            for (const lzSide of [dep / 2 + 0.08, -(dep / 2 + 0.08)]) {
              const q = winLong.clone();
              if (lzSide < 0) q.rotateY(Math.PI);
              q.rotateY(yaw);
              q.translate(place(lx, ly, lzSide), ly, placeZ(lx, ly, lzSide));
              winGeos.push(q);
            }
            for (const lxSide of [w / 2 + 0.08, -(w / 2 + 0.08)]) {
              const q2 = winSide.clone();
              q2.rotateY(lxSide > 0 ? Math.PI / 2 : -Math.PI / 2);
              q2.rotateY(yaw);
              q2.translate(place(lxSide, ly, lx), ly, placeZ(lxSide, ly, lx));
              winGeos.push(q2);
            }
          }
        }
      }
    }
    const walls = new THREE.Mesh(
      mergeGeos_(wallGeos),
      new THREE.MeshLambertMaterial({ color: 0x8d959e })
    );
    this.scene.add(walls);
    const windows = new THREE.Mesh(
      mergeGeos_(winGeos),
      new THREE.MeshLambertMaterial({
        color: 0x3f7fd4, emissive: 0x16345c, emissiveIntensity: 0.55,
        side: THREE.DoubleSide,
      })
    );
    this.scene.add(windows);
    this.buildingMeshes = [walls, windows];
  }

  buildRoad() {
    const segments = this.segments;
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) % 1;
      const point = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const left = point.clone().add(normal.clone().multiplyScalar(this.width / 2));
      const right = point.clone().add(normal.clone().multiplyScalar(-this.width / 2));

      vertices.push(left.x, left.y, left.z);
      vertices.push(right.x, right.y, right.z);
    }

    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = a + 2;
      const d = b + 2;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({ color: 0x333333, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);
  }

  buildCurbs() {
    const segments = this.segments;

    const buildSide = (side) => {
      const vertices = [];
      const colors = [];
      const indices = [];

      const red = [0.85, 0.1, 0.1];
      const white = [0.95, 0.95, 0.95];

      let currentIndex = 0;

      for (let i = 0; i < segments; i++) {
        const t0 = (i / segments) % 1;
        const t1 = ((i + 1) / segments) % 1;

        const p0 = this.curve.getPointAt(t0);
        const tan0 = this.curve.getTangentAt(t0);
        const n0 = new THREE.Vector3(-tan0.z, 0, tan0.x).normalize();

        const p1 = this.curve.getPointAt(t1);
        const tan1 = this.curve.getTangentAt(t1);
        const n1 = new THREE.Vector3(-tan1.z, 0, tan1.x).normalize();

        const inner0 = p0.clone().add(n0.clone().multiplyScalar(side * (this.width / 2)));
        const outer0 = p0.clone().add(n0.clone().multiplyScalar(side * (this.width / 2 + this.curbWidth)));
        inner0.y += 0.02;
        outer0.y += 0.02;

        const inner1 = p1.clone().add(n1.clone().multiplyScalar(side * (this.width / 2)));
        const outer1 = p1.clone().add(n1.clone().multiplyScalar(side * (this.width / 2 + this.curbWidth)));
        inner1.y += 0.02;
        outer1.y += 0.02;

        const color = Math.floor(i / this.curbSegmentLength) % 2 === 0 ? red : white;

        vertices.push(inner0.x, inner0.y, inner0.z);
        vertices.push(outer0.x, outer0.y, outer0.z);
        vertices.push(inner1.x, inner1.y, inner1.z);
        vertices.push(outer1.x, outer1.y, outer1.z);

        colors.push(...color, ...color, ...color, ...color);

        const a = currentIndex;
        const b = currentIndex + 1;
        const c = currentIndex + 2;
        const d = currentIndex + 3;

        indices.push(a, b, c);
        indices.push(b, d, c);

        currentIndex += 4;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      return new THREE.Mesh(geometry, material);
    };

    this.leftCurb = buildSide(1);
    this.rightCurb = buildSide(-1);
    this.scene.add(this.leftCurb);
    this.scene.add(this.rightCurb);
  }

  // Línea de meta a cuadros, en la recta de meta (donde arranca el coche)
  buildStartLine() {
    const p = this.startPos, tg = this.startTangent;
    const nl = new THREE.Vector3(-tg.z, 0, tg.x);
    const w = this.width, th = 1.2, cols = 12, rows = 2;
    const verts = [], colors = [], idx = [];
    const white = [0.95, 0.95, 0.95], dark = [0.15, 0.15, 0.15];
    const corner = (lat, lon) => [
      p.x + nl.x * lat + tg.x * lon, 0.02, p.z + nl.z * lat + tg.z * lon
    ];
    let vi = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat0 = -w / 2 + (c * w) / cols;
        const lat1 = -w / 2 + ((c + 1) * w) / cols;
        const lon0 = -th / 2 + (r * th) / rows;
        const lon1 = -th / 2 + ((r + 1) * th) / rows;
        const col = (r + c) % 2 === 0 ? white : dark;
        for (const [la, lo] of [[lat0, lon0], [lat1, lon0], [lat0, lon1], [lat1, lon1]]) {
          const v = corner(la, lo);
          verts.push(v[0], v[1], v[2]);
          colors.push(col[0], col[1], col[2]);
        }
        idx.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
        vi += 4;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  buildGround() {
    const geometry = new THREE.PlaneGeometry(6000, 6000);
    const material = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.scene.add(ground);
  }
}
