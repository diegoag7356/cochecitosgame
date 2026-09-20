// ============================================================
// Sistema de faltas y penalizaciones (APEX GP)
//  · Amonestación: roce/touch con otro coche (3 = +3 s al global)
//  · Embestida accidental: +10 s · Embestida a posta: expulsión
//  · Salida anticipada: +20 s
//  · Atajo (4 ruedas fuera para beneficiarse): +10 s · si además
//    adelantas con el atajo: devolver posición o DSQ (15 s de gracia)
//  · La clasificación se ordena por progreso y el tiempo global
//    (tiempo de carrera + penalizaciones) decide el orden final.
// ============================================================

let _listener = null;
export function setFaultListener(fn) { _listener = fn; }
function emit(type, data) { if (_listener) _listener(type, data); }

export class Faults {
  constructor(session, track) {
    this.session = session;
    this.track = track;
    this.warnings = 0;          // amonestaciones (roces)
    this.penaltySec = 0;        // segundos añadidos al tiempo global
    this.jumpStartSec = 0;
    this.cutting = null;        // estado del atajo: {uStart, gained}
    this.cutPending = null;     // {deadline, atGain} debe devolver posición
    this.enabled = true;
  }

  notice(text, kind = 'yellow', ms = 3200) {
    emit('notice', { text, kind, ms });
  }

  // ---- Amonestaciones por roce ----
  touch() {
    if (!this.enabled) return;
    this.warnings++;
    if (this.warnings === 3) {
      this.warnings = 0;
      this.penaltySec += 3;
      this.notice('3 AMONESTACIONES · +3.0 s', 'yellow');
    } else {
      this.notice('AMONESTACIÓN ' + this.warnings + '/3 · ROCE', 'yellow');
    }
  }

  // ---- Embestidas ----
  penalty(kind, impact = 0, rel = 0) {
    if (!this.enabled) return;
    // Embestida MUY fuerte y clara (más de 150 km/h de cierre) = a posta
    if (kind === 'ram' && rel > 41) {
      this.ramIntentional();
      return;
    }
    const heavy = impact > 0.38 || rel > 14;
    if (kind === 'ram' && heavy) {
      this.penaltySec += 10;
      this.notice('EMBESTIDA · +10.0 s', 'red');
      emit('ram', { impact, rel });
    } else if (kind === 'ram') {
      this.touch(); // toque frontal suave: cuenta como roce
    } else if (kind === 'touch') {
      this.touch();
    }
  }

  ramIntentional() {
    if (!this.enabled) return;
    this.session.disqualified = true;
    this.session.finished = true;
    this.notice('EMBESTIDA A POSTA · DESCALIFICADO', 'red', 6000);
    emit('dsq', { reason: 'ram-intentional' });
  }

  jumpStart() {
    if (!this.enabled) return;
    this.jumpStartSec = 20;
    this.notice('SALIDA ANTICIPADA · +20.0 s', 'red', 5000);
  }

  // ---- Atajos: 4 ruedas fuera del asfalto con ganancia de progreso ----
  // Se llama cada frame desde la física con la posición del coche.
  trackCut(x, z, offTrack, vAbs, now) {
    if (!this.enabled) return;
    const u = this.track.arcOf(x, z);
    if (offTrack && vAbs > 8) {
      if (!this.cutting) this.cutting = { u0: u, gain: 0, offAll: true, t: now };
      const dd = ((u - this.cutting.u0) % 1 + 1) % 1;
      this.cutting.gain = dd * this.track.trackLen();
      this.cutting.offAll = this.cutting.offAll && offTrack;
    } else if (this.cutting) {
      // Volvió al asfalto: evaluar
      const c = this.cutting;
      this.cutting = null;
      if (c.offAll && c.gain > 12 && (now - c.t) > 600) {
        this.penaltySec += 10;
        this.notice('ATAJO · +10.0 s', 'yellow');
        this.cutPending = { deadline: now + 15000, atGain: c.gain };
      }
    }
  }

  // Devolver posición: si con el atajo adelantaste, debes dejar pasar
  // (simplificación: si tu progreso neto ganado con el atajo se mantiene
  // por encima del rival que estaba delante, te descartan al vencer el plazo)
  tick(now) {
    if (this.cutPending && now > this.cutPending.deadline) {
      const gainedPos = this.session.__cutGainedPosition;
      if (gainedPos) {
        this.session.disqualified = true;
        this.session.finished = true;
        this.notice('NO DEVOLVISTE LA POSICIÓN · DESCALIFICADO', 'red', 6000);
        emit('dsq', { reason: 'cut-keep-position' });
      }
      this.cutPending = null;
    }
  }

  // Tiempo global del jugador con penalizaciones aplicadas
  globalTime(raceTimeMs) {
    return raceTimeMs + (this.penaltySec + this.jumpStartSec) * 1000;
  }
}
