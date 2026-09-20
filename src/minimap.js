// Minimapa 2D: la pista se pre-renderiza una vez en un canvas oculto y cada
// frame solo se copia + se dibuja el triángulo del coche. Coste nimio.

const KART = {
  bg: 'rgba(8, 12, 16, 0.72)',
  border: 'rgba(255,255,255,0.14)',
  grass: 'rgba(46, 125, 50, 0.6)',
  asphalt: '#2b2f36',
  edge: 'rgba(235,240,245,0.75)',
  center: 'rgba(255,255,255,0.16)',
  drs: '#00e450',
  meta: '#ffffff',
  car: '#ff7a1a',
};

export class MiniMap {
  constructor(canvas, track, { size = 240 } = {}) {
    this.canvas = canvas;
    this.size = size;
    this.track = track;
    this.myColor = null;     // color del jugador (lo fija el juego)
    this.cars = [];          // rivales [{x, z, heading, color}]
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    this.ctx = canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Trazado -> caja del canvas (con margen)
    const C = track.centers;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of C) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 20;
    const s = Math.min(
      (size - pad * 2) / (maxX - minX),
      (size - pad * 2) / (maxZ - minZ)
    );
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this.toMap = (x, z) => [(x - cx) * s + size / 2, (z - cz) * s + size / 2];

    this.base = this._prerender();
  }

  // Devuelve un canvas oculto con pista, bordes, DRS y meta ya dibujados
  _prerender() {
    const { size, dpr, track } = this;
    const off = document.createElement('canvas');
    off.width = size * dpr;
    off.height = size * dpr;
    const ctx = off.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fondo redondeado
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, size, size, 12);
    else ctx.rect(0, 0, size, size);
    ctx.fillStyle = KART.bg;
    ctx.fill();
    ctx.strokeStyle = KART.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    const C = track.centers;
    const path = new Path2D();
    for (let i = 0; i < C.length; i += 2) {
      const [mx, my] = this.toMap(C[i].x, C[i].z);
      if (i === 0) path.moveTo(mx, my); else path.lineTo(mx, my);
    }
    path.closePath();

    // Bordes del asfalto (paralelas al eje, a ±width/2)
    const offsetPath = (o) => {
      const p = new Path2D();
      for (let i = 0; i < C.length; i++) {
        const a = C[i], b = C[(i + 1) % C.length];
        const dx = b.x - a.x, dz = b.z - a.z;
        const il = 1 / (Math.hypot(dx, dz) || 1);
        const [mx, my] = this.toMap(a.x - dz * il * o, a.z + dx * il * o);
        if (i === 0) p.moveTo(mx, my); else p.lineTo(mx, my);
      }
      p.closePath();
      return p;
    };

    ctx.lineJoin = ctx.lineCap = 'round';
    // Hierba alrededor del asfalto
    ctx.strokeStyle = KART.grass;
    ctx.lineWidth = 16;
    ctx.stroke(path);
    // Asfalto
    ctx.strokeStyle = KART.asphalt;
    ctx.lineWidth = 12;
    ctx.stroke(path);
    // Bordes blancos
    ctx.strokeStyle = KART.edge;
    ctx.lineWidth = 1.4;
    ctx.stroke(offsetPath(track.width / 2));
    ctx.stroke(offsetPath(-track.width / 2));
    // Eje punteado sutil
    ctx.strokeStyle = KART.center;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]);
    ctx.stroke(path);
    ctx.setLineDash([]);

    // Zonas DRS en verde (tramos separados)
    const zones = track.drsZones || (track.drsPts ? [track.drsPts] : []);
    for (const zone of zones) {
      if (!zone || zone.length < 2) continue;
      const drs = new Path2D();
      for (let i = 0; i < zone.length; i += 2) {
        const [mx, my] = this.toMap(zone[i].x, zone[i].z);
        if (i === 0) drs.moveTo(mx, my); else drs.lineTo(mx, my);
      }
      ctx.strokeStyle = KART.drs;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 6;
      ctx.stroke(drs);
      ctx.globalAlpha = 1;
    }

    // Línea de meta (blanca, cruzando el asfalto)
    if (track.startPos && track.startTangent) {
      const tg = track.startTangent;
      const nx = -tg.z, nz = tg.x;
      const h = track.width / 2;
      const [x1, y1] = this.toMap(track.startPos.x + nx * h, track.startPos.z + nz * h);
      const [x2, y2] = this.toMap(track.startPos.x - nx * h, track.startPos.z - nz * h);
      ctx.strokeStyle = KART.meta;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    return off;
  }

  // Coches en el mapa: rivales como puntos de color, jugador como triángulo
  update(x, z, heading, cars) {
    const { ctx, size } = this;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, 0, 0, size, size);

    const drawDot = (cx, cy, color) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.stroke();
    };
    if (cars) for (const c of cars) {
      const [mx, my] = this.toMap(c.x, c.z);
      drawDot(mx, my, c.color);
    }

    const [mx, my] = this.toMap(x, z);
    // Mundo -> mapa: +X mapa = +X mundo, +Y mapa = +Z mundo (visto desde arriba)
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    const ang = Math.atan2(fz, fx);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 4.6);
    ctx.lineTo(-2.6, 0);
    ctx.lineTo(-5, -4.6);
    ctx.closePath();
    ctx.fillStyle = this.myColor || KART.car;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}
