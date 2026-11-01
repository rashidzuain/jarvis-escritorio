// =====================================================================
//  REPRODUCTOR DE VOZ con efecto "IA holográfica" + análisis en vivo
//
//  Cadena de audio:
//   voz → tono más grave → filtro de graves → calidez → presencia → aire
//       → compresor (sonido de locutor) → mezcla con coro y reverb sutiles
//       → analizador (para la animación) → parlantes
//
//  El analizador entrega en cada cuadro el volumen real, tres bandas
//  (graves, medios, agudos) y la forma de onda, así el núcleo se mueve
//  exactamente con lo que dice.
// =====================================================================
export class VozJarvis {
  constructor() {
    this.ctx = null;
    this.fuente = null;
    this.alTerminar = null;
  }

  crearCadena(efecto) {
    const ctx = this.ctx;
    const n = (tipo, props = {}) => Object.assign(ctx[tipo](), props);

    this.entrada = ctx.createGain();
    this.analizador = n('createAnalyser', { fftSize: 1024, smoothingTimeConstant: 0.55 });
    const salida = ctx.createGain();
    salida.gain.value = 0.95;

    if (efecto === 'ninguno') {
      this.entrada.connect(this.analizador);
    } else {
      const corte = n('createBiquadFilter', { type: 'highpass' }); corte.frequency.value = 85;
      const calidez = n('createBiquadFilter', { type: 'lowshelf' }); calidez.frequency.value = 220; calidez.gain.value = 3.5;
      const barro = n('createBiquadFilter', { type: 'peaking' }); barro.frequency.value = 450; barro.Q.value = 1.1; barro.gain.value = -2.5;
      const presencia = n('createBiquadFilter', { type: 'peaking' }); presencia.frequency.value = 3200; presencia.Q.value = 0.9; presencia.gain.value = 3;
      const aire = n('createBiquadFilter', { type: 'highshelf' }); aire.frequency.value = 9000; aire.gain.value = 2.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -22; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.18; comp.knee.value = 8;

      // Doble fijo: una copia apenas desfasada (sin modulación, para que la voz no "tiemble")
      // le da el brillo "digital"; se filtra a agudos para no ensuciar la voz
      const coro = ctx.createDelay(0.05); coro.delayTime.value = 0.011;
      const brillo = n('createBiquadFilter', { type: 'highpass' }); brillo.frequency.value = 1800;
      const nivelCoro = ctx.createGain(); nivelCoro.gain.value = 0.12;

      // Reverb corta generada al vuelo (sala metálica pequeña)
      const reverb = ctx.createConvolver();
      reverb.buffer = this.impulso(0.4, 3.6);
      const nivelReverb = ctx.createGain(); nivelReverb.gain.value = 0.09;

      const seco = ctx.createGain(); seco.gain.value = 1;
      this.entrada.connect(corte).connect(calidez).connect(barro).connect(presencia).connect(aire).connect(comp);
      comp.connect(seco).connect(this.analizador);
      comp.connect(coro).connect(brillo).connect(nivelCoro).connect(this.analizador);
      comp.connect(reverb).connect(nivelReverb).connect(this.analizador);
    }
    this.analizador.connect(salida).connect(ctx.destination);
    this.efecto = efecto;
    this.datosFrecuencia = new Uint8Array(this.analizador.frequencyBinCount);
    this.datosOnda = new Float32Array(this.analizador.fftSize);
  }

  impulso(segundos, caida) {
    const tasa = this.ctx.sampleRate;
    const largo = Math.floor(tasa * segundos);
    const buf = this.ctx.createBuffer(2, largo, tasa);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < largo; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** caida;
    }
    return buf;
  }

  /**
   * Reproduce PCM int16 mono. Devuelve una promesa que se cumple al terminar.
   * alCuadro(analisis) se llama ~60 veces por segundo mientras suena.
   */
  async reproducir(pcmBytes, tasa, { tono = 0.96, efecto = 'holografico', alCuadro, alEmpezar } = {}) {
    this.detener();
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.analizador || this.efecto !== efecto) this.crearCadena(efecto);

    const muestras = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.byteLength / 2));
    const buf = this.ctx.createBuffer(1, muestras.length || 1, tasa);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < muestras.length; i++) canal[i] = muestras[i] / 32768;

    const fuente = this.ctx.createBufferSource();
    fuente.buffer = buf;
    fuente.playbackRate.value = efecto === 'ninguno' ? 1 : tono;
    fuente.connect(this.entrada);
    this.fuente = fuente;
    const duracion = buf.duration / fuente.playbackRate.value;

    return new Promise((resolve) => {
      const inicio = this.ctx.currentTime;
      let activo = true;
      const cuadro = () => {
        if (!activo) return;
        alCuadro?.(this.analizar(), Math.min(1, (this.ctx.currentTime - inicio) / duracion));
        requestAnimationFrame(cuadro);
      };
      fuente.onended = () => {
        activo = false;
        if (this.fuente === fuente) this.fuente = null;
        alCuadro?.({ volumen: 0, graves: 0, medios: 0, agudos: 0, onda: null }, 1);
        resolve();
      };
      fuente.start();
      alEmpezar?.(duracion);
      requestAnimationFrame(cuadro);
    });
  }

  // Volumen, bandas y onda en este instante
  analizar() {
    const a = this.analizador;
    a.getFloatTimeDomainData(this.datosOnda);
    a.getByteFrequencyData(this.datosFrecuencia);
    let suma = 0;
    for (let i = 0; i < this.datosOnda.length; i++) suma += this.datosOnda[i] ** 2;
    const volumen = Math.min(1, Math.sqrt(suma / this.datosOnda.length) * 4.5);
    const hz = this.ctx.sampleRate / a.fftSize;
    const banda = (desde, hasta) => {
      let s = 0; let k = 0;
      for (let i = Math.floor(desde / hz); i <= Math.min(this.datosFrecuencia.length - 1, Math.ceil(hasta / hz)); i++) { s += this.datosFrecuencia[i]; k++; }
      return k ? s / k / 255 : 0;
    };
    return { volumen, graves: banda(70, 300), medios: banda(300, 2200), agudos: banda(2200, 9000), onda: this.datosOnda };
  }

  detener() {
    if (this.fuente) {
      const f = this.fuente;
      this.fuente = null;
      try { f.stop(); } catch { /* ya terminó */ }
    }
  }

  get hablando() { return !!this.fuente; }
}
