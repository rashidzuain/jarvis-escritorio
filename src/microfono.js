// =====================================================================
//  MICRÓFONO con detector de voz liviano
//  · El micrófono solo se abre mientras escucha y se cierra al terminar.
//  · Detecta cuándo empezás y terminás de hablar midiendo la energía del
//    sonido (casi no usa CPU); solo esos fragmentos se mandan a transcribir.
//  · Detector de doble aplauso: busca dos golpes cortos y secos separados
//    entre 0,18 y 0,8 s. No transcribe nada, así que es prácticamente gratis.
// =====================================================================
const TASA = 16000;

export class Microfono {
  constructor({ alNivel, alAplauso, sensibilidad = 1 } = {}) {
    this.alNivel = alNivel || (() => {});
    this.alAplauso = alAplauso || null;
    this.sensibilidad = sensibilidad;
    this.abierto = false;
    this.ruidoFondo = 0.006;
    this.oyente = null;
    this.reloj = 0;           // ms de audio procesado
    this.ap = { fondo: 0.01, previo: 0, enGolpe: false, inicio: 0, max: 0, golpes: [], pendiente: 0, enfriamiento: 0 };
  }

  async abrir() {
    if (this.abierto) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      // Sin supresión de ruido ni ganancia automática: esos filtros "aplanan" los aplausos.
      // La cancelación de eco queda activa para que no se escuche a sí mismo hablando.
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext({ sampleRate: TASA });
    await this.ctx.audioWorklet.addModule('microfono-worklet.js');
    this.fuente = this.ctx.createMediaStreamSource(this.stream);
    this.nodo = new AudioWorkletNode(this.ctx, 'captura');
    this.nodo.port.onmessage = (e) => this.bloque(e.data);
    this.fuente.connect(this.nodo);
    this.abierto = true;
  }

  cerrar() {
    if (!this.abierto) return;
    this.abierto = false;
    try { this.fuente.disconnect(); this.nodo.port.onmessage = null; } catch { /* nada */ }
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close().catch(() => {});
    this.oyente = null;
  }

  bloque(muestras) {
    let suma = 0;
    let pico = 0;
    for (let i = 0; i < muestras.length; i++) {
      const v = muestras[i];
      suma += v * v;
      if (v > pico) pico = v; else if (-v > pico) pico = -v;
    }
    const rms = Math.sqrt(suma / muestras.length);
    this.reloj += (muestras.length / TASA) * 1000;
    this.alNivel(rms);
    if (this.alAplauso) this.detectarAplausos(rms, pico);
    this.oyente?.(muestras, rms);
  }

  // Aplauso = subida brusca de volumen que dura menos de ~110 ms.
  // La voz sube más despacio y dura más, así que no lo dispara.
  detectarAplausos(rms, pico) {
    const d = this.ap;
    const t = this.reloj;
    const s = this.sensibilidad;
    const umbral = Math.max(0.05 / s, d.fondo * 7);

    if (!d.enGolpe) {
      if (rms > umbral && rms > d.previo * 2.5 && pico > 0.2 / s) {
        d.enGolpe = true;
        d.inicio = t;
        d.max = rms;
      } else {
        d.fondo = d.fondo * 0.995 + Math.min(rms, 0.05) * 0.005;
      }
    } else {
      d.max = Math.max(d.max, rms);
      const duracion = t - d.inicio;
      if (rms < d.max * 0.25 || rms < umbral * 0.5) {
        d.enGolpe = false;
        if (duracion <= 110) {
          d.golpes = d.golpes.filter((g) => d.inicio - g < 900);
          d.golpes.push(d.inicio);
          if (d.golpes.length === 2) {
            const separacion = d.golpes[1] - d.golpes[0];
            d.pendiente = separacion >= 180 && separacion <= 800 ? t + 350 : 0;
            if (!d.pendiente) d.golpes = [d.golpes[1]];
          } else if (d.golpes.length > 2) {          // tres o más = aplausos de verdad, no una orden
            d.golpes = [];
            d.pendiente = 0;
          }
        } else {
          d.golpes = [];
          d.pendiente = 0;
        }
      } else if (duracion > 110) {                   // sonido largo: voz, música… no es aplauso
        d.enGolpe = false;
        d.golpes = [];
        d.pendiente = 0;
      }
    }
    d.previo = rms;

    if (d.pendiente && t >= d.pendiente) {
      d.pendiente = 0;
      d.golpes = [];
      if (t >= d.enfriamiento) {
        d.enfriamiento = t + 2500;
        this.alAplauso();
      }
    }
  }

  /**
   * Espera una frase: arranca cuando detecta voz y termina tras un silencio.
   * Devuelve Float32Array (16 kHz) o null si nadie habló a tiempo / se canceló.
   */
  escucharFrase({ esperaInicioMs = 6000, silencioMs = 900, maxSeg = 15, minSeg = 0.35 } = {}) {
    return new Promise((resolve) => {
      const partes = [];
      const previo = [];          // un poquito de audio antes de detectar voz, para no cortar la primera sílaba
      let hablando = false;
      let msVoz = 0;
      let msSilencio = 0;
      let msEspera = 0;
      const msBloque = (128 / TASA) * 1000;

      const terminar = (ok) => {
        this.oyente = null;
        this.cancelarFrase = null;
        if (!ok) return resolve(null);
        const total = partes.reduce((n, p) => n + p.length, 0);
        if (total / TASA < minSeg) return resolve(null);
        const audio = new Float32Array(total);
        let o = 0;
        for (const p of partes) { audio.set(p, o); o += p.length; }
        resolve(audio);
      };
      this.cancelarFrase = () => terminar(false);

      this.oyente = (m, rms) => {
        const umbral = Math.max(0.012, this.ruidoFondo * 3.2);
        const esVoz = rms > umbral;
        if (!hablando) {
          // Aprende el ruido de fondo mientras no hablás
          this.ruidoFondo = this.ruidoFondo * 0.97 + rms * 0.03;
          previo.push(m);
          if (previo.length > 12) previo.shift();
          if (esVoz) {
            msVoz += msBloque;
            if (msVoz > 90) { hablando = true; partes.push(...previo); }
          } else {
            msVoz = 0;
            msEspera += msBloque;
            if (esperaInicioMs && msEspera > esperaInicioMs) terminar(false);
          }
          return;
        }
        partes.push(m);
        msSilencio = esVoz ? 0 : msSilencio + msBloque;
        const duracion = (partes.length * 128) / TASA;
        if (msSilencio > silencioMs || duracion > maxSeg) terminar(true);
      };
    });
  }

  cancelar() { this.cancelarFrase?.(); }
}
