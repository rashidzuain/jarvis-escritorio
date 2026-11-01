// Orbe de red neuronal: una esfera 3D de nodos conectados, con pulsos que viajan
// por las conexiones, un núcleo que respira y anillos de HUD. Cambia de color y
// velocidad según el estado: inactivo, pensando, hablando, alerta, error.

const ESTADOS = {
  inactivo: { color: [80, 210, 255], giro: 0.0035, pulsos: 0.06, brillo: 0.75 },
  pensando: { color: [150, 125, 255], giro: 0.016, pulsos: 0.9, brillo: 1.0 },
  hablando: { color: [95, 235, 255], giro: 0.007, pulsos: 0.35, brillo: 1.0 },
  alerta: { color: [255, 175, 70], giro: 0.009, pulsos: 0.5, brillo: 1.0 },
  escuchando: { color: [90, 255, 160], giro: 0.006, pulsos: 0.3, brillo: 1.0 },
  error: { color: [255, 85, 95], giro: 0.002, pulsos: 0.03, brillo: 0.6 },
};

class Orbe {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.estado = 'inactivo';
    this.fpsMax = 60;
    this.ultimoDibujo = 0;
    this.color = [...ESTADOS.inactivo.color];
    this.giro = ESTADOS.inactivo.giro;
    this.brillo = ESTADOS.inactivo.brillo;
    this.rotY = 0;
    this.rotX = 0.35;
    this.t = 0;
    this.amp = 0;          // amplitud de "voz" (0..1)
    this.ampObjetivo = 0;
    this.nodos = [];
    this.aristas = [];
    this.pulsos = [];
    this.construir();
    this.redimensionar();
    new ResizeObserver(() => this.redimensionar()).observe(canvas);
    requestAnimationFrame((ts) => this.cuadro(ts));
  }

  construir() {
    const externos = 150;
    const dorado = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < externos; i++) {
      const y = 1 - (i / (externos - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = dorado * i;
      const rad = 0.88 + Math.random() * 0.12;
      this.nodos.push({ x: Math.cos(th) * r * rad, y: y * rad, z: Math.sin(th) * r * rad, fase: Math.random() * 6.28, interno: false });
    }
    for (let i = 0; i < 34; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const rad = 0.3 + Math.random() * 0.32;
      const s = Math.sqrt(1 - u * u);
      this.nodos.push({ x: Math.cos(a) * s * rad, y: u * rad, z: Math.sin(a) * s * rad, fase: Math.random() * 6.28, interno: true });
    }
    const n = this.nodos.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.nodos[i];
        const b = this.nodos[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const umbral = a.interno || b.interno ? 0.36 : 0.3;
        if (d < umbral) this.aristas.push([i, j]);
      }
    }
  }

  redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setEstado(e) { if (ESTADOS[e]) this.estado = e; }

  // Llamar mientras habla: valores 0..1
  setBandas({ graves = 0, medios = 0 } = {}) { this.setAmplitud(Math.max(graves, medios)); }
  setOnda() {}

  setAmplitud(v) { this.ampObjetivo = Math.max(this.ampObjetivo, Math.min(1, v)); }

  proyectar(n, cx, cy, R) {
    const cY = Math.cos(this.rotY); const sY = Math.sin(this.rotY);
    const cX = Math.cos(this.rotX); const sX = Math.sin(this.rotX);
    const x1 = n.x * cY - n.z * sY;
    const z1 = n.x * sY + n.z * cY;
    const y2 = n.y * cX - z1 * sX;
    const z2 = n.y * sX + z1 * cX;
    const f = 2.8 / (2.8 - z2);
    return { x: cx + x1 * R * f, y: cy + y2 * R * f, z: z2, p: (z2 + 1) / 2 };
  }

  cuadro(ts) {
    requestAnimationFrame((t) => this.cuadro(t));
    if (document.hidden || ts - this.ultimoDibujo < 1000 / this.fpsMax - 2) return;
    this.ultimoDibujo = ts;
    const obj = ESTADOS[this.estado];
    const ctx = this.ctx;
    this.t += 1;

    // Transiciones suaves
    for (let k = 0; k < 3; k++) this.color[k] += (obj.color[k] - this.color[k]) * 0.06;
    this.giro += (obj.giro - this.giro) * 0.05;
    this.brillo += (obj.brillo - this.brillo) * 0.05;
    this.amp += (this.ampObjetivo - this.amp) * 0.25;
    this.ampObjetivo *= 0.9;
    if (this.estado === 'hablando') this.ampObjetivo = Math.max(this.ampObjetivo, 0.15 + 0.25 * Math.abs(Math.sin(ts / 140)));

    this.rotY += this.giro * (1 + this.amp * 1.5);
    this.rotX = 0.35 + Math.sin(ts / 4000) * 0.12;

    const [r, g, b] = this.color.map(Math.round);
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const respira = Math.sin(ts / 900) * 0.5 + 0.5;
    const R = Math.min(this.w, this.h) * 0.3 * (1 + this.amp * 0.07 + respira * 0.015);

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';

    // Halo de fondo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.7);
    halo.addColorStop(0, rgba(0.22 * this.brillo));
    halo.addColorStop(0.5, rgba(0.07 * this.brillo));
    halo.addColorStop(1, rgba(0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, Math.PI * 2); ctx.fill();

    // Proyección de nodos
    const P = this.nodos.map((n) => this.proyectar(n, cx, cy, R));

    // Conexiones
    ctx.lineWidth = 0.7;
    for (const [i, j] of this.aristas) {
      const a = P[i]; const c = P[j];
      const prof = (a.p + c.p) / 2;
      ctx.strokeStyle = rgba((0.05 + 0.3 * prof * prof) * this.brillo);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }

    // Pulsos que viajan por las conexiones (la "actividad neuronal")
    let nuevos = obj.pulsos * (1 + this.amp * 2);
    while (nuevos > 0) {
      if (Math.random() < nuevos) {
        this.pulsos.push({ e: (Math.random() * this.aristas.length) | 0, t: 0, v: 0.02 + Math.random() * 0.045, inv: Math.random() < 0.5 });
      }
      nuevos -= 1;
    }
    this.pulsos = this.pulsos.filter((p) => (p.t += p.v) < 1);
    for (const p of this.pulsos) {
      const [i, j] = this.aristas[p.e];
      const a = p.inv ? P[j] : P[i];
      const c = p.inv ? P[i] : P[j];
      const x = a.x + (c.x - a.x) * p.t;
      const y = a.y + (c.y - a.y) * p.t;
      const prof = a.p + (c.p - a.p) * p.t;
      const rad = 2.2 + prof * 2.5;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
      gr.addColorStop(0, `rgba(255,255,255,${0.9 * prof})`);
      gr.addColorStop(0.35, rgba(0.7 * prof));
      gr.addColorStop(1, rgba(0));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, rad * 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // Nodos
    for (let k = 0; k < P.length; k++) {
      const q = P[k];
      const titila = 0.75 + 0.25 * Math.sin(ts / 600 + this.nodos[k].fase);
      ctx.fillStyle = rgba((0.2 + 0.8 * q.p) * titila * this.brillo);
      ctx.beginPath(); ctx.arc(q.x, q.y, 0.7 + q.p * 1.7, 0, Math.PI * 2); ctx.fill();
    }

    // Núcleo
    const rn = R * (0.2 + this.amp * 0.12 + respira * 0.02);
    const nucleo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rn * 2.4);
    nucleo.addColorStop(0, `rgba(255,255,255,${0.95 * this.brillo})`);
    nucleo.addColorStop(0.25, rgba(0.85 * this.brillo));
    nucleo.addColorStop(0.6, rgba(0.18 * this.brillo));
    nucleo.addColorStop(1, rgba(0));
    ctx.fillStyle = nucleo;
    ctx.beginPath(); ctx.arc(cx, cy, rn * 2.4, 0, Math.PI * 2); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';

    // Onda de voz alrededor de la esfera
    if (this.amp > 0.03) {
      ctx.strokeStyle = rgba(0.55 * this.amp + 0.1);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k <= 120; k++) {
        const a = (k / 120) * Math.PI * 2;
        const ruido = Math.sin(a * 6 + ts / 120) * 0.5 + Math.sin(a * 11 - ts / 90) * 0.5;
        const rr = R * 1.12 + ruido * R * 0.09 * this.amp;
        const x = cx + Math.cos(a) * rr; const y = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Anillos de HUD
    this.anillo(cx, cy, R * 1.28, ts / 3000, 3, 0.55, 1.4, rgba(0.5 * this.brillo));
    this.anillo(cx, cy, R * 1.4, -ts / 4500, 5, 0.25, 0.8, rgba(0.35 * this.brillo));
    this.marcas(cx, cy, R * 1.5, ts / 9000, rgba(0.3 * this.brillo));
  }

  anillo(cx, cy, rad, rot, segmentos, largo, ancho, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = ancho;
    const paso = (Math.PI * 2) / segmentos;
    for (let i = 0; i < segmentos; i++) {
      const ini = rot + i * paso;
      ctx.beginPath(); ctx.arc(cx, cy, rad, ini, ini + paso * largo); ctx.stroke();
    }
  }

  marcas(cx, cy, rad, rot, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const a = rot + (i / 60) * Math.PI * 2;
      const l = i % 5 === 0 ? 6 : 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      ctx.lineTo(cx + Math.cos(a) * (rad + l), cy + Math.sin(a) * (rad + l));
      ctx.stroke();
    }
  }
}

window.Orbe2D = Orbe;
