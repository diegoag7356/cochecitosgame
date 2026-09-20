// ============================================================
// APEX GP · Multijugador con Firebase Realtime Database
//  · Crear sala: genera código de 5 letras y escribe la sala.
//  · Unirse: nombre obligatorio + código (si no, no puedes entrar).
//  · Elección de color POR ORDEN DE UNIÓN (turnos con candado).
//  · Listo → todos listos = vuelta de reconocimiento (sin colisiones,
//    sin faltas), línea amarilla de clasificación y parrilla por orden
//    de llegada. Salida 3-2-1 y semáforo final con las reglas de faltas.
//
// Estructura en /rooms/{id}:
//   meta   { host, status, createdAt, laps, bots, roomSize, order }
//   players/{pid} { name, color, ready, joinedAt }
//   grid   { pid: slotIndex }      (asignada tras la vuelta clasificatoria)
// ============================================================

import { initializeApp } from 'firebase/app';
import {
  getDatabase, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp,
} from 'firebase/database';

const FIREBASE_CFG = {
  apiKey: 'AIzaSyCFHjfO6UC9AqXFS04K5apMp8z3S8HmiE',
  authDomain: 'cochecitosgame.firebaseapp.com',
  databaseURL: 'https://cochecitosgame-default-rtdb.firebaseio.com',
  projectId: 'cochecitosgame',
  appId: '1:341308637321:web:apexgp',
};

const app = initializeApp(FIREBASE_CFG);
const db = getDatabase(app);

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}
const pid = 'p' + Math.random().toString(36).slice(2, 10);
export { pid as MP_PID };

export class Multiplayer {
  constructor(onRoomUpdate) {
    this.roomId = null;
    this.isHost = false;
    this.room = null;         // snapshot de la sala
    this.unsubscribe = null;
    this.onRoomUpdate = onRoomUpdate || (() => {});
  }

  // ---- Crear sala ----
  async createRoom(cfg) {
    // Código único
    let id = makeCode();
    for (let i = 0; i < 8; i++) {
      const snap = await get(ref(db, 'rooms/' + id));
      if (!snap.exists()) break;
      id = makeCode();
    }
    this.roomId = id;
    this.isHost = true;
    await set(ref(db, `rooms/${id}/meta`), {
      host: pid,
      status: 'lobby',         // lobby | picking | recon | grid | racing | finished
      createdAt: serverTimestamp(),
      laps: cfg.laps || 5,
      bots: cfg.bots !== false,
      roomSize: cfg.roomSize || 8,
      pickingTurn: 0,          // índice del jugador que elige color
    });
    // El host entra automáticamente como primer jugador
    await this.join(id, cfg.name);
    this._listen();
    return id;
  }

  // ---- Unirse (exige nombre) ----
  async join(code, name) {
    if (!name || !name.trim()) throw new Error('NEEDS_NAME');
    if (!code || code.length < 4) throw new Error('NEEDS_CODE');
    const roomRef = ref(db, `rooms/${code}`);
    const snap = await get(roomRef);
    if (!snap.exists()) throw new Error('ROOM_NOT_FOUND');
    const room = snap.val();
    const players = room.players || {};
    if (Object.keys(players).length >= (room.meta.roomSize || 8) && !players[pid]) {
      throw new Error('ROOM_FULL');
    }
    this.roomId = code;
    this.isHost = room.meta.host === pid;
    const joinedAt = Date.now();
    const usedColors = Object.values(players).map((p) => p.color);
    const myColor = CAR_COLORS.find((c) => !usedColors.includes(c.hex))?.hex || '#e10600';
    await update(ref(db, `rooms/${code}/players/${pid}`), {
      name: name.trim().slice(0, 12),
      color: this.isHost ? (usedColors.includes('#e10600') ? myColor : '#e10600') : myColor,
      ready: false,
      joinedAt,
    });
    await onDisconnect(ref(db, `rooms/${code}/players/${pid}`)).remove();
    this._listen();
  }

  _listen() {
    if (this.unsubscribe) this.unsubscribe();
    const roomRef = ref(db, `rooms/${this.roomId}`);
    this.unsubscribe = onValue(roomRef, (snap) => {
      this.room = snap.val();
      this.onRoomUpdate(this.room);
    });
    onDisconnect(ref(db, `rooms/${this.roomId}/players/${pid}`)).remove();
  }

  me() { return this.room && this.room.players ? this.room.players[pid] : null; }
  playersSorted() {
    if (!this.room || !this.room.players) return [];
    return Object.entries(this.room.players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  }

  // ---- Elección de color por orden de unión ----
  myTurn() {
    const ps = this.playersSorted();
    const meta = this.room?.meta || {};
    const idx = ps.findIndex((p) => p.id === pid);
    return (meta.status === 'picking') && idx >= 0 && meta.pickingTurn === idx;
  }
  async pickColor(hex) {
    if (!this.myTurn() || !this.room) return false;
    const taken = this.playersSorted().some((p) => p.color === hex);
    if (taken) return false;
    await update(ref(db, `rooms/${this.roomId}/players/${pid}`), { color: hex });
    // Pasa el turno (o termina la fase)
    const ps = this.playersSorted();
    const next = this.room.meta.pickingTurn + 1;
    if (next >= ps.length) {
      await update(ref(db, `rooms/${this.roomId}/meta`), { pickingTurn: -1, status: 'picking-done' });
    } else {
      await update(ref(db, `rooms/${this.roomId}/meta`), { pickingTurn: next });
    }
    return true;
  }
  async setReady(v) {
    await update(ref(db, `rooms/${this.roomId}/players/${pid}`), { ready: !!v });
  }

  // ---- Host: comenzar (fase de color) ----
  async startPicking() {
    await update(ref(db, `rooms/${this.roomId}/meta`), { status: 'picking', pickingTurn: 0 });
  }

  // ---- Host: todos listos → vuelta de reconocimiento ----
  allReady() {
    const ps = this.playersSorted();
    return ps.length > 0 && ps.every((p) => p.ready);
  }
  async startRecon() {
    await update(ref(db, `rooms/${this.roomId}/meta`), { status: 'recon', reconStart: serverTimestamp() });
  }
  async setGridSlot(slot) {
    await set(ref(db, `rooms/${this.roomId}/grid/${pid}`), slot);
  }
  async setStatus(status) {
    await update(ref(db, `rooms/${this.roomId}/meta`), { status });
  }
  // ---- Estado en pista (10 Hz) ----
  async publishState(x, z, heading, v) {
    if (!this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}/players/${pid}`), {
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      heading: Math.round((heading || 0) * 1000) / 1000,
      v: Math.round((v || 0) * 10) / 10,
    });
  }
  async leaveRoom() {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    if (this.roomId) await remove(ref(db, `rooms/${this.roomId}/players/${pid}`));
    this.roomId = null;
    this.room = null;
  }
}

// Paleta compartida con el juego local (importada de menu.js para no duplicar)
import { CAR_COLORS } from './menu.js';
