// =====================================================================
//  NÚCLEO 3D/4D — motor visual de Jarvis (WebGL con three.js)
//
//  Capas, de adentro hacia afuera:
//   · Núcleo de energía: icosaedro de alambre + destello central
//   · Teseracto: hipercubo de 4 dimensiones girando en los planos XW/YW/ZW,
//     proyectado a 3D (por eso las "caras" se dan vuelta de adentro hacia afuera)
//   · Red neuronal: esfera de neuronas con sinapsis por donde viajan pulsos
//   · Escáner holográfico que recorre la esfera
//   · Anillos giroscópicos y un disco de partículas de datos en órbita
//   · HUD fijo: regla circular y onda de voz
//  Todo pasa por un bloom (resplandor) y se compone con transparencia real.
// =====================================================================
import * as THREE from './vendor/three/three.module.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './vendor/three/addons/postprocessing/ShaderPass.js';
import { LineSegments2 } from './vendor/three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from './vendor/three/addons/lines/LineMaterial.js';

THREE.ColorManagement.enabled = false; // los colores se usan tal cual (espacio de pantalla)

const ESTADOS = {
  arranque: { color: [0.31, 0.82, 1.0], giro: 0.6, giro4d: 1.2, pulsos: 0.6, bloom: 0.9, escaneo: 2.0, orbita: 1.4 },
  inactivo: { color: [0.31, 0.82, 1.0], giro: 0.10, giro4d: 0.32, pulsos: 0.16, bloom: 0.62, escaneo: 0.45, orbita: 0.25 },
  pensando: { color: [0.60, 0.48, 1.0], giro: 0.45, giro4d: 1.70, pulsos: 0.80, bloom: 0.85, escaneo: 1.70, orbita: 1.00 },
  hablando: { color: [0.36, 0.94, 1.0], giro: 0.20, giro4d: 0.75, pulsos: 0.45, bloom: 0.8, escaneo: 0.90, orbita: 0.50 },
  alerta: { color: [1.0, 0.64, 0.22], giro: 0.25, giro4d: 0.95, pulsos: 0.55, bloom: 0.82, escaneo: 1.30, orbita: 0.60 },
  escuchando: { color: [0.35, 1.0, 0.62], giro: 0.18, giro4d: 0.55, pulsos: 0.35, bloom: 0.8, escaneo: 1.1, orbita: 0.45 },
  error: { color: [1.0, 0.28, 0.34], giro: 0.04, giro4d: 0.12, pulsos: 0.04, bloom: 0.5, escaneo: 0.20, orbita: 0.08 },
};

const R_ESFERA = 1.6;
const CAMARA_Z = 9;

// ---------------- Shaders ----------------
const PROFUNDIDAD_GLSL = /* glsl */`
  uniform float uCentroZ;
  uniform float uRadio;
  float profundidad(vec4 mv) { return clamp(0.5 + (mv.z - uCentroZ) / (2.0 * uRadio), 0.0, 1.0); }
`;

const PUNTOS_VS = /* glsl */`
  ${PROFUNDIDAD_GLSL}
  attribute float aFase;
  attribute float aTam;
  uniform float uTiempo;
  uniform float uPx;
  uniform float uAmp;
  varying float vBrillo;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float prof = profundidad(mv);
    float titila = 0.6 + 0.4 * sin(uTiempo * 2.2 + aFase);
    vBrillo = (0.18 + 0.82 * prof) * titila;
    gl_PointSize = aTam * uPx * (0.55 + 0.65 * prof) * (1.0 + uAmp * 0.35);
  }
`;

const PUNTOS_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uIntensidad;
  varying float vBrillo;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    float a = exp(-r * 4.5);
    vec3 c = mix(uColor, vec3(1.0), a * 0.55);
    gl_FragColor = vec4(c * a * vBrillo * uIntensidad, 1.0);
  }
`;

const SINAPSIS_VS = /* glsl */`
  ${PROFUNDIDAD_GLSL}
  attribute float aLado;
  attribute float aSemilla;
  varying float vLado;
  varying float vSemilla;
  varying float vProf;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vProf = profundidad(mv);
    vLado = aLado;
    vSemilla = aSemilla;
  }
`;

const SINAPSIS_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uTiempo;
  uniform float uPulsos;
  uniform float uIntensidad;
  uniform float uLinea;
  varying float vLado;
  varying float vSemilla;
  varying float vProf;
  float azar(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
  void main() {
    float base = 0.03 + 0.17 * vProf * vProf;
    float vel = 0.35 + fract(vSemilla * 13.7) * 0.9;
    float ciclo = uTiempo * vel + vSemilla * 10.0;
    float activo = step(azar(floor(ciclo) + vSemilla * 78.233), uPulsos);
    float p = fract(ciclo);
    float pos = mix(p, 1.0 - p, step(0.5, fract(vSemilla * 7.0)));
    float d = vLado - pos;
    float pulso = exp(-d * d * 220.0) * activo;
    vec3 c = uColor * base + mix(uColor, vec3(1.0), 0.65) * pulso * (0.5 + 0.9 * vProf);
    gl_FragColor = vec4(c * uIntensidad * uLinea, 1.0);
  }
`;

const ANILLO_VS = /* glsl */`
  attribute float aAng;
  varying float vAng;
  void main() {
    vAng = aAng;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ANILLO_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uTiempo;
  uniform float uIntensidad;
  uniform float uSegmentos;
  uniform float uLleno;
  uniform float uVel;
  uniform float uFuerza;
  uniform float uLinea;
  varying float vAng;
  void main() {
    float seg = step(fract(vAng * uSegmentos), uLleno);
    float h = fract(vAng - uTiempo * uVel);
    float destello = exp(-pow(min(h, 1.0 - h) * 18.0, 2.0));
    float a = seg * (0.35 + 1.4 * destello) * uFuerza * uLinea;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), destello * 0.5) * a * uIntensidad, 1.0);
  }
`;

const ORBITA_VS = /* glsl */`
  attribute float aRadio;
  attribute float aAng;
  attribute float aVel;
  attribute float aAltura;
  attribute float aFase;
  uniform float uTiempo;
  uniform float uPx;
  varying float vBrillo;
  void main() {
    float ang = aAng + uTiempo * aVel;
    vec3 p = vec3(cos(ang) * aRadio, aAltura, sin(ang) * aRadio);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float prof = clamp(0.5 + (mv.z + ${CAMARA_Z.toFixed(1)}) / 5.0, 0.0, 1.0);
    vBrillo = (0.15 + 0.85 * prof) * (0.5 + 0.5 * sin(uTiempo * 3.0 + aFase));
    gl_PointSize = uPx * (1.2 + 1.6 * prof);
  }
`;

// Último paso: el alfa sale del brillo → transparencia real sobre el escritorio
const ALFA_SHADER = {
  uniforms: { tDiffuse: { value: null }, uHalo: { value: 0.45 }, uAspecto: { value: 1 }, uRadioHalo: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uHalo;
    uniform float uAspecto;
    uniform float uRadioHalo;
    varying vec2 vUv;
    void main() {
      vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(1.0));
      float a = clamp(max(max(c.r, c.g), c.b) * 1.1, 0.0, 1.0);
      // Vidrio oscuro detrás del orbe: da contraste sobre fondos claros
      vec2 p = (vUv - 0.5) * vec2(max(uAspecto, 1.0), max(1.0 / uAspecto, 1.0));
      float d = length(p);
      // Fundido circular hacia los bordes: nada queda cortado contra el borde de la ventana
      float fundido = 1.0 - smoothstep(0.36, 0.5, d);
      c *= fundido;
      a *= fundido;
      float halo = uHalo * (1.0 - smoothstep(uRadioHalo * 0.6, uRadioHalo * 1.12, d));
      gl_FragColor = vec4(c, max(a, halo));
    }`,
};

// ---------------- Utilidades ----------------
function esferaFibonacci(n, radio, jitter = 0) {
  const pts = [];
  const dorado = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = dorado * i;
    const rad = radio * (1 - Math.random() * jitter);
    pts.push(new THREE.Vector3(Math.cos(th) * r * rad, y * rad, Math.sin(th) * r * rad));
  }
  return pts;
}

function circulo(radio, n, plano = 'xz') {
  const pos = new Float32Array(n * 3);
  const ang = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a) * radio;
    const s = Math.sin(a) * radio;
    if (plano === 'xz') pos.set([c, 0, s], i * 3); else pos.set([c, s, 0], i * 3);
    ang[i] = i / n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
  return g;
}

function rotar4D(v, a, b, c, d) {
  let [x, y, z, w] = v;
  let t;
  t = x * Math.cos(a) - w * Math.sin(a); w = x * Math.sin(a) + w * Math.cos(a); x = t;
  t = y * Math.cos(b) - w * Math.sin(b); w = y * Math.sin(b) + w * Math.cos(b); y = t;
  t = z * Math.cos(c) - w * Math.sin(c); w = z * Math.sin(c) + w * Math.cos(c); z = t;
  t = x * Math.cos(d) - y * Math.sin(d); y = x * Math.sin(d) + y * Math.cos(d); x = t;
  return [x, y, z, w];
}

const aditivo = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };

// =====================================================================
export class Nucleo3D {
  constructor(canvas, { bloom = true, halo = 0, calidad = 'alta', marco = false } = {}) {
    this.conMarco = marco;
    this.canvas = canvas;
    this.estado = 'inactivo';
    this.fpsMax = 60;          // la interfaz lo baja en reposo para ahorrar recursos
    this.ultimoDibujo = 0;
    this.amp = 0;
    this.ampObjetivo = 0;
    this.bandas = { graves: 0, medios: 0, agudos: 0 };   // audio real de la voz (0..1)
    this.onda = null;
    this.ultimaOnda = 0;
    this.p = { ...ESTADOS.inactivo, color: [...ESTADOS.inactivo.color] };
    this.inclinacion = new THREE.Vector2();
    this.inclinacionObjetivo = new THREE.Vector2();
    this.angulos4d = [0, 0, 0, 0];
    this.t0 = performance.now();
    this.tPrevio = this.t0;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    // Superresolución: en calidad alta dibuja a 1.5x–2x y la pantalla lo achica → bordes nítidos
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.renderer.setPixelRatio(calidad === 'baja' ? Math.min(dpr, 1.5) : Math.min(Math.max(dpr * 1.5, 2), 3));

    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camara.position.set(0, 0, CAMARA_Z);

    // Uniformes compartidos (todas las capas cambian de color juntas)
    this.u = {
      uTiempo: { value: 0 },
      uColor: { value: new THREE.Vector3(...this.p.color) },
      uIntensidad: { value: 1 },
      uPulsos: { value: this.p.pulsos },
      uAmp: { value: 0 },
      uPx: { value: this.renderer.getPixelRatio() },
      uCentroZ: { value: -CAMARA_Z },
      uRadio: { value: R_ESFERA * 1.05 },
      uLinea: { value: 1 },
    };

    this.mundo = new THREE.Group();
    this.hud = new THREE.Group();
    this.escena.add(this.mundo, this.hud);

    this.crearRedNeuronal();
    this.crearTeseracto();
    this.crearNucleo();
    this.crearAnillos();
    this.crearEscaner();
    this.crearOrbita();
    this.crearHUD();
    this.crearMembranas();

    // Posprocesado: escena → bloom (opcional) → alfa desde el brillo
    // Imagen intermedia con antialiasing MSAA (sin esto las líneas salen serradas)
    const destino = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: calidad === 'baja' ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, destino);
    this.composer.addPass(new RenderPass(this.escena, this.camara));
    if (bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.p.bloom, 0.42, 0.18);
      this.composer.addPass(this.bloom);
    }
    this.pasoAlfa = new ShaderPass(ALFA_SHADER);
    this.pasoAlfa.uniforms.uHalo.value = halo;
    this.composer.addPass(this.pasoAlfa);

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.inclinacionObjetivo.set(((e.clientX - r.left) / r.width - 0.5) * 0.7, ((e.clientY - r.top) / r.height - 0.5) * 0.5);
    });
    canvas.addEventListener('pointerleave', () => this.inclinacionObjetivo.set(0, 0));

    this.redimensionar();
    new ResizeObserver(() => this.redimensionar()).observe(canvas);
    this.renderer.setAnimationLoop(() => this.cuadro());
  }

  // ---------- Capas ----------
  crearRedNeuronal() {
    const externos = esferaFibonacci(300, R_ESFERA, 0.12);
    const internos = Array.from({ length: 60 }, () => new THREE.Vector3().randomDirection().multiplyScalar(0.5 + Math.random() * 0.6));
    const nodos = [...externos, ...internos];
    const n = nodos.length;

    // Datos para las formaciones: dirección, azar y velocidad propia de cada neurona
    this.nNodos = n;
    this.base = new Float32Array(n * 3);
    this.azar = new Float32Array(n * 2);
    this.velNodo = new Float32Array(n);
    const pos = new Float32Array(n * 3);
    const fase = new Float32Array(n);
    const tam = new Float32Array(n);
    nodos.forEach((v, i) => {
      this.base.set([v.x, v.y, v.z], i * 3);
      // arrancan dispersas lejos: en el encendido se juntan hasta formar la esfera
      const d = v.clone().normalize().multiplyScalar(3.5 + Math.random() * 3);
      pos.set([d.x, d.y, d.z], i * 3);
      this.azar[i * 2] = Math.random();
      this.azar[i * 2 + 1] = Math.random();
      this.velNodo[i] = 2.6 + Math.random() * 3;
      fase[i] = Math.random() * Math.PI * 2;
      tam[i] = i < externos.length ? 3.5 + Math.random() * 3.5 : 3 + Math.random() * 2.5;
    });
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gp.setAttribute('aFase', new THREE.BufferAttribute(fase, 1));
    gp.setAttribute('aTam', new THREE.BufferAttribute(tam, 1));
    this.neuronas = new THREE.Points(gp, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PUNTOS_VS, fragmentShader: PUNTOS_FS, ...aditivo }));
    this.neuronas.frustumCulled = false;

    // Sinapsis: se eligen en la forma de esfera y se estiran/comprimen al cambiar de formación
    const pares = [];
    const lado = [];
    const semilla = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const interna = i >= externos.length || j >= externos.length;
        if (nodos[i].distanceTo(nodos[j]) < (interna ? 0.58 : 0.44)) {
          const s = Math.random();
          pares.push(i, j);
          lado.push(0, 1);
          semilla.push(s, s);
        }
      }
    }
    this.pares = Uint16Array.from(pares);
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pares.length * 3), 3));
    gl.setAttribute('aLado', new THREE.Float32BufferAttribute(lado, 1));
    gl.setAttribute('aSemilla', new THREE.Float32BufferAttribute(semilla, 1));
    this.sinapsis = new THREE.LineSegments(gl, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SINAPSIS_VS, fragmentShader: SINAPSIS_FS, ...aditivo }));
    this.sinapsis.frustumCulled = false;

    this.red = new THREE.Group();
    this.red.add(this.sinapsis, this.neuronas);
    this.mundo.add(this.red);
  }

  // Cada estado tiene su forma (inspirado en los orbes de partículas):
  //  · reposo: esfera hueca · pensando: núcleo denso con chispas que salen despedidas
  //  · hablando: se expande y late con la voz · escuchando: se contrae un poco
  //  · arranque: partículas dispersas que se juntan
  actualizarFormacion(dt, t) {
    const pos = this.neuronas.geometry.attributes.position.array;
    const e = this.estado;
    const graves = this.bandas.graves;
    for (let i = 0; i < this.nNodos; i++) {
      const k = i * 3;
      const bx = this.base[k]; const by = this.base[k + 1]; const bz = this.base[k + 2];
      const r1 = this.azar[i * 2]; const r2 = this.azar[i * 2 + 1];
      let f;
      if (e === 'pensando') f = r1 < 0.8 ? (0.42 + r2 * 0.3) / Math.max(0.3, Math.hypot(bx, by, bz)) : 1.2 + r2 * 0.6;
      else if (e === 'hablando') f = 1.04 + graves * 0.14 + Math.sin(t * 3 + r1 * 6.28) * 0.03;
      else if (e === 'escuchando') f = 0.88 + Math.sin(t * 2 + r1 * 6.28) * 0.02;
      else if (e === 'arranque') f = 2.4 + r2 * 2;
      else f = 1;
      // deriva orgánica permanente
      const deriva = 0.025;
      const tx = bx * f + Math.sin(t * 0.7 + r1 * 40) * deriva;
      const ty = by * f + Math.sin(t * 0.6 + r2 * 40) * deriva;
      const tz = bz * f + Math.sin(t * 0.8 + (r1 + r2) * 20) * deriva;
      const a = 1 - Math.exp(-dt * this.velNodo[i] * (e === 'pensando' ? 1.6 : 1));
      pos[k] += (tx - pos[k]) * a;
      pos[k + 1] += (ty - pos[k + 1]) * a;
      pos[k + 2] += (tz - pos[k + 2]) * a;
    }
    this.neuronas.geometry.attributes.position.needsUpdate = true;
    const lp = this.sinapsis.geometry.attributes.position.array;
    for (let p = 0; p < this.pares.length; p++) {
      const o = this.pares[p] * 3;
      lp[p * 3] = pos[o]; lp[p * 3 + 1] = pos[o + 1]; lp[p * 3 + 2] = pos[o + 2];
    }
    this.sinapsis.geometry.attributes.position.needsUpdate = true;
  }

  // Membranas líquidas: anillos de partículas que ondulan como agua (más con la voz)
  crearMembranas() {
    const capas = 3;
    const porCapa = 760;
    const total = capas * porCapa;
    const ang = new Float32Array(total);
    const capa = new Float32Array(total);
    const r1 = new Float32Array(total);
    const r2 = new Float32Array(total);
    for (let c = 0; c < capas; c++) {
      for (let i = 0; i < porCapa; i++) {
        const k = c * porCapa + i;
        ang[k] = i / porCapa + Math.random() * 0.002;
        capa[k] = c;
        r1[k] = Math.random();
        r2[k] = Math.random();
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
    g.setAttribute('aCapa', new THREE.BufferAttribute(capa, 1));
    g.setAttribute('aR1', new THREE.BufferAttribute(r1, 1));
    g.setAttribute('aR2', new THREE.BufferAttribute(r2, 1));
    this.uMembrana = { uVoz: { value: 0 }, uEscalaM: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, ...this.uMembrana },
      vertexShader: /* glsl */`
        attribute float aAng; attribute float aCapa; attribute float aR1; attribute float aR2;
        uniform float uTiempo; uniform float uPx; uniform float uVoz; uniform float uEscalaM; uniform float uIntensidad;
        varying float vBrillo;
        void main() {
          float th = aAng * 6.2831853;
          float R = 2.22 + aCapa * 0.11;
          float ond = sin(th * 3.0 + uTiempo * 0.55 + aCapa * 1.7) * 0.5
                    + sin(th * 5.0 - uTiempo * 0.85 + aCapa * 2.3) * 0.3
                    + sin(th * 9.0 + uTiempo * 1.5 + aCapa) * 0.2;
          float r = (R + ond * (0.045 + uVoz * 0.16) + (aR1 - 0.5) * 0.06) * uEscalaM;
          vec3 p = vec3(cos(th) * r, sin(th) * r, (aR2 - 0.5) * 0.2);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          vBrillo = (0.45 + 0.55 * aR2) * (0.6 + 0.4 * sin(uTiempo * 2.0 + aR1 * 30.0)) * (0.9 + uVoz * 0.5) / max(uIntensidad, 0.4);
          gl_PointSize = uPx * (1.3 + aR1 * 1.5);
        }`,
      fragmentShader: PUNTOS_FS,
      ...aditivo,
    });
    this.membranas = new THREE.Points(g, mat);
    this.membranas.frustumCulled = false;
    this.hud.add(this.membranas);
  }

  crearTeseracto() {
    // 16 vértices (±½)^4 y 32 aristas (vértices que difieren en una sola coordenada)
    this.v4 = [];
    for (let i = 0; i < 16; i++) this.v4.push([0, 1, 2, 3].map((b) => ((i >> b) & 1 ? 0.5 : -0.5)));
    this.aristas4 = [];
    for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (i < j) this.aristas4.push([i, j]); }

    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(this.aristas4.length * 6));
    this.matTeseracto = new LineMaterial({ color: 0xffffff, linewidth: 1.7, worldUnits: false, ...aditivo, opacity: 1 });
    this.teseracto = new LineSegments2(geo, this.matTeseracto);
    this.teseracto.frustumCulled = false;

    const gv = new THREE.BufferGeometry();
    gv.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    gv.setAttribute('aFase', new THREE.BufferAttribute(Float32Array.from({ length: 16 }, () => Math.random() * 6.28), 1));
    gv.setAttribute('aTam', new THREE.BufferAttribute(new Float32Array(16).fill(9), 1));
    this.vertices4 = new THREE.Points(gv, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PUNTOS_VS, fragmentShader: PUNTOS_FS, ...aditivo }));
    this.vertices4.frustumCulled = false;

    this.mundo.add(this.teseracto, this.vertices4);
  }

  actualizarTeseracto() {
    const [a, b, c, d] = this.angulos4d;
    const p3 = this.v4.map((v) => {
      const [x, y, z, w] = rotar4D(v, a, b, c, d);
      const k = 3.3 / (3.2 - w);
      return [x * k, y * k, z * k];
    });
    const buf = this.teseracto.geometry.attributes.instanceStart.data;
    this.aristas4.forEach(([i, j], n) => { buf.array.set(p3[i], n * 6); buf.array.set(p3[j], n * 6 + 3); });
    buf.needsUpdate = true;
    const pv = this.vertices4.geometry.attributes.position;
    p3.forEach((q, i) => pv.array.set(q, i * 3));
    pv.needsUpdate = true;
  }

  crearNucleo() {
    const ico = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.26, 1));
    this.matIco = new THREE.LineBasicMaterial({ color: 0xffffff, ...aditivo, opacity: 0.6 });
    this.ico = new THREE.LineSegments(ico, this.matIco);
    const gd = new THREE.BufferGeometry();
    gd.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    gd.setAttribute('aFase', new THREE.BufferAttribute(new Float32Array(1), 1));
    this.tamDestello = new THREE.BufferAttribute(new Float32Array([26]), 1);
    gd.setAttribute('aTam', this.tamDestello);
    this.destello = new THREE.Points(gd, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PUNTOS_VS, fragmentShader: PUNTOS_FS, ...aditivo }));
    this.mundo.add(this.ico, this.destello);
  }

  crearAnillos() {
    // Un solo anillo giroscópico (las membranas líquidas hacen el resto)
    const def = this.conMarco
      ? [{ r: 1.95, segs: 3, lleno: 0.6, vel: 0.22, fuerza: 0.5, rot: [1.25, 0.0, 0.25], giro: [0, 0.35, 0] }]
      : [];
    this.anillos = def.map((d) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: this.u.uColor, uTiempo: this.u.uTiempo, uIntensidad: this.u.uIntensidad, uLinea: this.u.uLinea,
          uSegmentos: { value: d.segs }, uLleno: { value: d.lleno }, uVel: { value: d.vel }, uFuerza: { value: d.fuerza },
        },
        vertexShader: ANILLO_VS, fragmentShader: ANILLO_FS, ...aditivo,
      });
      const anillo = new THREE.LineLoop(circulo(d.r, 360), mat);
      anillo.userData.fuerza = d.fuerza;
      const pivote = new THREE.Group();
      pivote.rotation.set(...d.rot);
      pivote.add(anillo);
      this.mundo.add(pivote);
      return { anillo, giro: d.giro };
    });
  }

  crearEscaner() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: this.u.uColor, uTiempo: this.u.uTiempo, uIntensidad: this.u.uIntensidad, uLinea: this.u.uLinea,
        uSegmentos: { value: 1 }, uLleno: { value: 1 }, uVel: { value: 0.6 }, uFuerza: { value: 1.1 },
      },
      vertexShader: ANILLO_VS, fragmentShader: ANILLO_FS, ...aditivo,
    });
    this.escaner = new THREE.LineLoop(circulo(1, 200), mat);
    this.faseEscaneo = 0;
    this.mundo.add(this.escaner);
  }

  crearOrbita() {
    const n = 650;
    const g = new THREE.BufferGeometry();
    const at = (f) => new THREE.BufferAttribute(Float32Array.from({ length: n }, f), 1);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aRadio', at(() => 2.45 + Math.random() ** 2 * 0.55));
    g.setAttribute('aAng', at(() => Math.random() * Math.PI * 2));
    g.setAttribute('aVel', at(() => 0.15 + Math.random() * 0.35));
    g.setAttribute('aAltura', at(() => (Math.random() - 0.5) * 0.09));
    g.setAttribute('aFase', at(() => Math.random() * 6.28));
    this.uOrbita = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uTiempo: this.uOrbita },
      vertexShader: ORBITA_VS, fragmentShader: PUNTOS_FS, ...aditivo,
    });
    this.orbita = new THREE.Points(g, mat);
    this.orbita.frustumCulled = false;
    const pivote = new THREE.Group();
    pivote.rotation.set(1.22, 0, -0.32);
    pivote.add(this.orbita);
    this.mundo.add(pivote);
  }

  crearHUD() {
    // Regla circular frente a la cámara
    const ticks = [];
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const largo = i % 15 === 0 ? 0.2 : i % 5 === 0 ? 0.1 : 0.045;
      const r = 2.72;
      ticks.push(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * (r + largo), Math.sin(a) * (r + largo), 0);
    }
    const gt = new THREE.BufferGeometry();
    gt.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    this.matTicks = new THREE.LineBasicMaterial({ color: 0xffffff, ...aditivo, opacity: 0.5 });
    this.regla = new THREE.LineSegments(gt, this.matTicks);

    // Arcos de encuadre (como un visor)
    const marco = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(this.arcos(2.98, [[-0.35, 0.35], [Math.PI - 0.35, Math.PI + 0.35]]), 3)),
      this.matTicks,
    );

    // Onda de voz
    this.nVoz = 180;
    const gv = new THREE.BufferGeometry();
    gv.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.nVoz * 3), 3));
    this.matVoz = new THREE.LineBasicMaterial({ color: 0xffffff, ...aditivo, opacity: 0 });
    this.voz = new THREE.LineLoop(gv, this.matVoz);

    this.hud.add(this.voz);
    if (this.conMarco) this.hud.add(this.regla, marco);   // reglas y arcos de visor: opcionales
  }

  arcos(r, rangos) {
    const out = [];
    for (const [a0, a1] of rangos) {
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        const b = a0 + ((a1 - a0) * (i + 1)) / n;
        out.push(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(b) * r, Math.sin(b) * r, 0);
      }
    }
    return out;
  }

  // ---------- API pública ----------
  setEstado(e) { if (ESTADOS[e]) this.estado = e; }
  setAmplitud(v) { this.ampObjetivo = Math.max(this.ampObjetivo, Math.min(1, v)); }

  // Análisis de la voz en vivo: cada banda mueve una capa distinta
  setBandas({ graves = 0, medios = 0, agudos = 0 } = {}) {
    const b = this.bandas;
    b.graves = Math.max(b.graves * 0.6, graves);
    b.medios = Math.max(b.medios * 0.6, medios);
    b.agudos = Math.max(b.agudos * 0.6, agudos);
  }

  // Forma de onda real → el anillo de voz dibuja el sonido tal cual
  setOnda(muestras) { this.onda = muestras; this.ultimaOnda = performance.now(); }

  redimensionar() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    // Que el orbe entre completo aunque el lienzo sea más alto que ancho
    const visible = 7.2;   // margen para que las membranas no lleguen al borde
    const fovV = (2 * Math.atan((visible / 2) / CAMARA_Z) * 180) / Math.PI;
    this.camara.fov = w >= h ? fovV : (2 * Math.atan(Math.tan((fovV * Math.PI) / 360) / this.camara.aspect) * 180) / Math.PI;
    this.camara.updateProjectionMatrix();
    if (this.pasoAlfa) {
      this.pasoAlfa.uniforms.uAspecto.value = this.camara.aspect;
      // radio del halo en coordenadas de pantalla: la esfera mide ~1.75 de las 6.4 unidades visibles
      this.pasoAlfa.uniforms.uRadioHalo.value = 2.05 / 7.2;
    }
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }

    // Los tamaños en píxeles (neuronas, líneas) acompañan al tamaño del lienzo
    this.escalaVisual = Math.min(1.6, Math.max(0.5, Math.min(w, h) / 320));
    this.u.uPx.value = this.renderer.getPixelRatio() * this.escalaVisual;
    const sobremuestreo = this.renderer.getPixelRatio() / this.dpr;
    this.matTeseracto.linewidth = Math.max(0.8, 1.15 * this.escalaVisual) * this.renderer.getPixelRatio();
    // Las líneas de 1 px se ven más finas al sobremuestrear: compensamos el brillo
    this.u.uLinea.value = Math.min(2.2, sobremuestreo);
    this.matTicks.opacity = Math.min(1, 0.5 * sobremuestreo);
    this.matIco.opacity = Math.min(1, 0.6 * sobremuestreo);
  }

  // ---------- Animación ----------
  cuadro() {
    if (document.hidden) return;
    const ahora = performance.now();
    // Límite de cuadros por segundo (ahorro de GPU/CPU en reposo)
    if (ahora - this.ultimoDibujo < 1000 / this.fpsMax - 2) return;
    this.ultimoDibujo = ahora;
    const dt = Math.min((ahora - this.tPrevio) / 1000, 0.05);
    this.tPrevio = ahora;
    const t = (ahora - this.t0) / 1000;
    const obj = ESTADOS[this.estado];
    const k = 1 - Math.exp(-dt * 3);

    for (const clave of ['giro', 'giro4d', 'pulsos', 'bloom', 'escaneo', 'orbita']) this.p[clave] += (obj[clave] - this.p[clave]) * k;
    for (let i = 0; i < 3; i++) this.p.color[i] += (obj.color[i] - this.p.color[i]) * k;

    if (this.estado === 'hablando') this.ampObjetivo = Math.max(this.ampObjetivo, 0.18 + 0.22 * Math.abs(Math.sin(t * 7)));
    this.amp += (this.ampObjetivo - this.amp) * Math.min(1, dt * 14);
    this.ampObjetivo *= Math.exp(-dt * 6);

    const [r, g, b] = this.p.color;
    this.u.uColor.value.set(r, g, b);
    this.u.uTiempo.value = t;
    // Las bandas se apagan solas si deja de llegar audio
    const bv = this.bandas;
    bv.graves *= Math.exp(-dt * 5); bv.medios *= Math.exp(-dt * 5); bv.agudos *= Math.exp(-dt * 5);
    this.u.uPulsos.value = Math.min(1, this.p.pulsos + bv.medios * 0.9);   // medios → disparan neuronas
    this.u.uAmp.value = this.amp;
    // Cuando las partículas se amontonan (pensando) o la cámara se acerca (hablando) se baja el brillo para no saturar
    const brilloEstado = { pensando: 0.3, hablando: 0.32, escuchando: 0.75, arranque: 0.5 }[this.estado] ?? 0.9;
    this.brilloForma = (this.brilloForma ?? 1) + (brilloEstado - (this.brilloForma ?? 1)) * (1 - Math.exp(-dt * 2.5));
    this.u.uIntensidad.value = (0.85 + this.amp * 0.08) * this.brilloForma;
    this.uOrbita.value += dt * (0.6 + this.p.orbita * 2.2 + bv.agudos * 3);   // agudos → aceleran las partículas

    // Rotaciones
    this.inclinacion.lerp(this.inclinacionObjetivo, k);
    this.mundo.rotation.x = 0.28 + this.inclinacion.y + Math.sin(t * 0.21) * 0.06;
    this.mundo.rotation.z = -this.inclinacion.x * 0.3;
    this.red.rotation.y += dt * this.p.giro * (1 + this.amp);
    for (const { anillo } of this.anillos) anillo.material.uniforms.uFuerza.value = anillo.userData.fuerza * (1 + bv.agudos * 1.6);   // agudos → brillan los anillos
    for (const { anillo, giro } of this.anillos) {
      anillo.rotation.x += dt * giro[0] * (0.6 + this.p.giro * 2);
      anillo.rotation.y += dt * giro[1] * (0.6 + this.p.giro * 2);
      anillo.rotation.z += dt * giro[2] * (0.6 + this.p.giro * 2);
    }
    this.mundo.rotation.y = this.inclinacion.x;

    // Formación de partículas según el estado
    this.actualizarFormacion(dt, t);

    // Membranas líquidas: aparecen en el encendido y ondulan más con la voz
    this.uMembrana.uVoz.value = Math.min(1.2, this.amp * 0.8 + bv.graves * 0.9);
    this.uMembrana.uEscalaM.value += ((this.estado === 'arranque' ? 0.35 : 1) - this.uMembrana.uEscalaM.value) * (1 - Math.exp(-dt * 2));

    // Cámara: al hablar se mete un poco dentro de la red
    const zObjetivo = this.estado === 'hablando' ? CAMARA_Z - 0.8 - bv.graves * 0.2 : this.estado === 'pensando' ? CAMARA_Z - 0.4 : CAMARA_Z;
    this.camara.position.z += (zObjetivo - this.camara.position.z) * (1 - Math.exp(-dt * 1.5));

    // Hipercubo 4D
    const v4 = dt * this.p.giro4d;
    this.angulos4d[0] += v4 * 0.9;
    this.angulos4d[1] += v4 * 0.55;
    this.angulos4d[2] += v4 * 0.7;
    this.angulos4d[3] += v4 * 0.25;
    this.actualizarTeseracto();
    const brilloT = (0.5 + this.amp * 0.1) * Math.max(0.55, this.brilloForma ?? 1);
    this.matTeseracto.color.setRGB(Math.min(1.6, (r * 0.6 + 0.4) * brilloT), Math.min(1.6, (g * 0.6 + 0.4) * brilloT), Math.min(1.6, (b * 0.6 + 0.4) * brilloT));

    // Núcleo
    this.ico.rotation.x += dt * 0.7;
    this.ico.rotation.y += dt * 1.1;
    const escalaNucleo = 1 + this.amp * 0.2 + bv.graves * 0.3 + Math.sin(t * 2.4) * 0.06;   // graves → late el núcleo
    this.ico.scale.setScalar(escalaNucleo);
    this.matIco.color.setRGB(r, g, b);
    this.tamDestello.array[0] = (16 + this.amp * 5 + bv.graves * 8) * (this.brilloForma ?? 1) + Math.sin(t * 2.4) * 3;
    this.tamDestello.needsUpdate = true;

    // Escáner holográfico
    this.faseEscaneo += dt * this.p.escaneo;
    const y = Math.sin(this.faseEscaneo) * R_ESFERA * 0.95;
    const radio = Math.sqrt(Math.max(0.0001, (R_ESFERA * 1.04) ** 2 - y * y));
    this.escaner.position.y = y;
    this.escaner.scale.setScalar(radio);

    // HUD
    this.regla.rotation.z -= dt * 0.05 * (1 + this.p.giro * 3);
    this.matTicks.color.setRGB(r, g, b);
    const ondaReal = this.onda && performance.now() - this.ultimaOnda < 150;
    if (ondaReal) {
      // Dibuja la forma de onda real alrededor del núcleo
      const pos = this.voz.geometry.attributes.position;
      const m = this.onda;
      const paso = Math.max(1, Math.floor(m.length / this.nVoz));
      for (let i = 0; i < this.nVoz; i++) {
        const a = (i / this.nVoz) * Math.PI * 2;
        const v = m[Math.min(m.length - 1, i * paso)] || 0;
        const borde = Math.sin((i / this.nVoz) * Math.PI);      // empalma el inicio con el final
        const rr = 1.92 + v * 0.55 * (0.4 + 0.6 * borde);
        pos.array.set([Math.cos(a) * rr, Math.sin(a) * rr, 0], i * 3);
      }
      pos.needsUpdate = true;
    } else if (this.amp > 0.015) {
      const pos = this.voz.geometry.attributes.position;
      for (let i = 0; i < this.nVoz; i++) {
        const a = (i / this.nVoz) * Math.PI * 2;
        const ruido = Math.sin(a * 6 + t * 9) * 0.55 + Math.sin(a * 13 - t * 7) * 0.3 + Math.sin(a * 3 + t * 4) * 0.15;
        const rr = 1.92 + ruido * 0.16 * this.amp;
        pos.array.set([Math.cos(a) * rr, Math.sin(a) * rr, 0], i * 3);
      }
      pos.needsUpdate = true;
    }
    this.matVoz.opacity = ondaReal ? 0.9 : Math.min(1, this.amp * 1.8);
    this.matVoz.color.setRGB(r * 0.7 + 0.3, g * 0.7 + 0.3, b * 0.7 + 0.3);

    if (this.bloom) this.bloom.strength = this.p.bloom * (1 + this.amp * 0.08 + bv.graves * 0.1);
    this.composer.render(dt);
  }
}
