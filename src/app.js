// Interfaz de Jarvis: chat, voz, permisos, acciones y modo proactivo.
// (módulo ES) — usa el núcleo 3D/4D y, si la PC no tiene WebGL, cae al orbe 2D.
const $ = (s) => document.querySelector(s);
const api = window.api;

let orbe = { estado: 'inactivo', setEstado(e) { this.estado = e; }, setAmplitud() {} };

async function crearOrbe() {
  const previo = orbe.estado;
  try {
    const { Nucleo3D } = await import('./nucleo3d.js');
    orbe = new Nucleo3D($('#orbe'), { bloom: cfg.calidadGrafica !== 'baja', calidad: cfg.calidadGrafica || 'alta', halo: cfg.haloOscuro ?? 0, marco: cfg.marcoHUD === true });
  } catch (err) {
    console.warn('Núcleo 3D no disponible, uso el orbe 2D:', err);
    const nuevo = $('#orbe').cloneNode();
    $('#orbe').replaceWith(nuevo);
    orbe = new window.Orbe2D(nuevo);
    $('#t-4d').textContent = 'MODO 2D';
  }
  orbe.setEstado(previo);
}

let cfg = {};
let acciones = {};
let historial = [];
let ocupado = false;
let vozActiva = true;
let ultimaActividad = Date.now();
let ultimoProactivo = Date.now();
const flujos = new Map();

api.onChunk(({ id, delta }) => flujos.get(id)?.(delta));

// ---------------- Estado visual ----------------
const ETIQUETAS = {
  inactivo: 'EN LÍNEA', pensando: 'PROCESANDO', hablando: 'RESPONDIENDO', alerta: 'ATENCIÓN', error: 'SIN CONEXIÓN', escuchando: 'ESCUCHANDO',
};
const COLORES = { inactivo: '80, 210, 255', pensando: '150, 125, 255', hablando: '95, 235, 255', alerta: '255, 170, 70', error: '255, 85, 95', escuchando: '90, 255, 160' };
let estadoVisible = '';

function descifrar(el, texto) {
  const signos = '█▓▒░<>/\\|#*+-=01';
  let paso = 0;
  clearInterval(el._t);
  el._t = setInterval(() => {
    paso += 1;
    el.textContent = [...texto].map((ch, i) => (i < paso - 2 || ch === ' ' ? ch : signos[(Math.random() * signos.length) | 0])).join('');
    if (paso > texto.length + 2) { clearInterval(el._t); el.textContent = texto; }
  }, 28);
}

function setEstado(e) {
  orbe.setEstado(e);
  document.documentElement.style.setProperty('--c', COLORES[e]);
  document.body.classList.toggle('oyendo', e === 'escuchando');
  document.body.classList.toggle('hablando', e === 'hablando');
  if (estadoVisible !== e) { estadoVisible = e; descifrar($('#estado-texto'), ETIQUETAS[e] || ''); }
  ajustarFps();
}

// ---------------- Ahorro de recursos ----------------
// El núcleo 3D va a 60 cuadros por segundo solo cuando está activo; en reposo baja a 24.
function ajustarFps() {
  const activo = ['pensando', 'hablando', 'escuchando', 'alerta'].includes(orbe.estado);
  const panelEnUso = document.body.classList.contains('expandido') && document.hasFocus();
  orbe.fpsMax = activo ? 60 : panelEnUso ? 40 : 24;
}
window.addEventListener('focus', ajustarFps);
window.addEventListener('blur', ajustarFps);

function volverAReposo() {
  if (!ocupado && !estaHablando() && orbe.estado !== 'error') setEstado('inactivo');
}

function expandir() {
  if (document.body.classList.contains('expandido')) return;
  document.body.classList.replace('compacto', 'expandido');
  api.modo('expandido');
  setTimeout(bajar, 50);
  ajustarFps();
}

function compactar() {
  document.body.classList.replace('expandido', 'compacto');
  api.modo('compacto');
  ajustarFps();
}

// ---------------- Texto ----------------
const RE_ACCION = /\[\[\s*ACCI[OÓ]N\s*:?\s*(\{[\s\S]*?\})\s*\]\]/gi;

function limpiar(t) {
  return t
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')   // razonamiento interno de modelos tipo qwen3
    .replace(RE_ACCION, '')
    .replace(/\[\[(?![\s\S]*\]\])[\s\S]*$/, '')     // acción a medio escribir
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extraerAcciones(t) {
  const sinPensar = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const lista = [];
  for (const m of sinPensar.matchAll(RE_ACCION)) {
    try {
      const { tipo, ...args } = JSON.parse(m[1]);
      if (tipo) lista.push({ tipo, args });
    } catch {
      lista.push({ tipo: null, args: { crudo: m[1] } });
    }
  }
  return lista;
}

// ---------------- Chat en pantalla ----------------
const horaCorta = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function bajar() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }

function burbuja(clase, texto = '') {
  const d = document.createElement('div');
  d.className = `msg ${clase}`;
  if (clase.includes('jarvis')) d.dataset.quien = `${(cfg.nombre || 'Jarvis').toUpperCase()}  ›  ${horaCorta()}`;
  if (clase.includes('usuario')) d.dataset.quien = `${horaCorta()}  ‹  VOS`;
  d.textContent = texto;
  $('#chat').appendChild(d);
  bajar();
  return d;
}

function chip(texto, fallo = false) {
  const d = document.createElement('div');
  d.className = `chip${fallo ? ' fallo' : ''}`;
  d.textContent = texto;
  d.title = texto;
  $('#chat').appendChild(d);
  bajar();
}

const ETIQUETA_CATEGORIA = {
  mensaje: 'ENVIAR UN MENSAJE', compra: 'COMPRA O PAGO', datos: 'COMPARTIR DATOS PERSONALES',
  sistema: 'COMANDO DEL SISTEMA', sensible: 'ACCIÓN SENSIBLE', control: 'CONTROL DE MOUSE Y TECLADO',
  memoria: 'GUARDAR EN MEMORIA', salida: 'ENVIAR DATOS A INTERNET',
};

/**
 * Tarjeta de autorización. Devuelve { ok, recordar, via: 'clic' | 'voz' }.
 * ev: evaluación de la guardia (critico, recordable, soloClic, contaminado, fuentes, motivo, categoria)
 */
function pedirPermiso(tipo, args, meta, ev = {}) {
  expandir();
  setEstado('alerta');
  return new Promise((resolve) => {
    const caja = document.createElement('div');
    caja.className = `permiso${ev.critico ? ' critico' : ''}`;
    caja.dataset.titulo = ev.critico
      ? `SIEMPRE SE CONSULTA · ${ETIQUETA_CATEGORIA[ev.categoria] || 'ACCIÓN CRÍTICA'}`
      : `AUTORIZACIÓN REQUERIDA${ETIQUETA_CATEGORIA[ev.categoria] ? ` · ${ETIQUETA_CATEGORIA[ev.categoria]}` : ''}`;

    const titulo = document.createElement('div');
    titulo.textContent = `${cfg.nombre || 'Jarvis'} quiere ${ev.motivo || meta.descripcion}.`;
    const detalle = document.createElement('code');
    detalle.textContent = args.comando || args.texto || args.url || args.ruta || args.consulta || JSON.stringify(args, null, 1);

    caja.append(titulo, detalle);

    // Contexto: ¿qué pidió el usuario? ¿se leyó contenido de afuera antes?
    if (pedidoActual) {
      const pedido = document.createElement('div');
      pedido.className = 'nota-pedido';
      pedido.textContent = `Tu pedido: «${pedidoActual.slice(0, 140)}»`;
      caja.append(pedido);
    }
    if (ev.contaminado) {
      const alerta = document.createElement('div');
      alerta.className = 'nota-alerta';
      alerta.textContent = `⚠ Esto se decidió después de leer contenido externo (${(ev.fuentes || []).join(', ')}). Si no es lo que pediste, denegalo: podría ser una instrucción plantada.`;
      caja.append(alerta);
    }

    const fila = document.createElement('div');
    fila.className = 'acciones-permiso';
    let resuelto = false;
    const responder = (ok, recordar = false, via = 'clic') => {
      if (resuelto) return;
      resuelto = true;
      mic?.cancelar();
      caja.remove();
      resolve({ ok, recordar, via });
    };
    const boton = (clase, texto, fn) => { const b = Object.assign(document.createElement('button'), { className: clase, textContent: texto }); b.onclick = fn; fila.append(b); };
    boton('si', ev.recordable ? 'Solo esta vez' : 'Permitir', () => responder(true));
    if (ev.recordable) boton('si siempre', 'Permitir siempre', () => responder(true, true));
    boton('no', 'Denegar', () => responder(false));

    const porVoz = cfg.vozEntrada && cfg.autorizacionPorVoz && !ev.soloClic;
    const frase = cfg.fraseAutorizacion || 'autorizo';
    const nota = document.createElement('div');
    nota.className = 'nota-voz';
    if (porVoz) nota.textContent = `🎙 También podés decir «${frase}» para permitir (solo esta vez) o «cancelar».`;
    else if (ev.soloClic && cfg.vozEntrada) nota.textContent = '🔒 Por seguridad, esta solo se autoriza con un clic.';
    if (nota.textContent) caja.append(nota);
    caja.append(fila);
    $('#chat').appendChild(caja);
    bajar();

    // Autorización por voz: exige la frase exacta (no alcanza con un "sí" suelto)
    if (porVoz) {
      (async () => {
        while (estaHablando()) await esperar(200);   // deja terminar la frase anterior
        await hablar(`Necesito tu autorización. Decí ${frase} para confirmar, o cancelar.`);
        for (let intento = 0; intento < 2 && !resuelto; intento++) {
          const texto = await escucharUnaVez({ esperaInicioMs: 8000 });
          if (resuelto) return;
          if (Date.now() - ultimoErrorMic < 1500) break;   // sin micrófono: queda el clic
          if (!texto) continue;
          const n = normalizar(texto);
          if (n.includes(normalizar(frase))) return responder(true, false, 'voz');
          if (/\b(cancelar|cancela|cancelalo|denegar|deniego|no)\b/.test(n)) return responder(false, false, 'voz');
        }
        if (!resuelto) setEstado('alerta');
      })();
    } else {
      hablar('Necesito tu autorización en pantalla.');
    }
  });
}

// ---------------- Voz ----------------
let vozElegida = null;

function elegirVoz() {
  const voces = speechSynthesis.getVoices();
  const buscada = (cfg.nombreVoz || '').toLowerCase();
  vozElegida = (buscada && voces.find((v) => v.name.toLowerCase().includes(buscada)))
    || voces.find((v) => /^es[-_](AR|419|MX|US)/i.test(v.lang))
    || voces.find((v) => v.lang?.toLowerCase().startsWith('es'))
    || null;
}
speechSynthesis.onvoiceschanged = elegirVoz;

// ---------------- Voz de Jarvis ----------------
// Motor "piper": voz neuronal local + efecto holográfico, y el núcleo se mueve con el audio real.
// Motor "sistema": voces de Windows (respaldo si Piper no está disponible).
let vozJ = null;
let turnoVoz = 0;           // sube cada vez que se corta la voz, para descartar audio viejo
let sintetizando = false;
let avisoPiper = false;

const estaHablando = () => speechSynthesis.speaking || sintetizando || !!vozJ?.hablando;

function callar() {
  turnoVoz += 1;
  speechSynthesis.cancel();
  vozJ?.detener();
  sintetizando = false;
}

// Subtítulo bajo el núcleo (modo chico): muestra las últimas palabras a medida que las dice
let ocultarSubtitulo = null;
function subtituloOrbe(texto) {
  const el = $('#subtitulo-orbe');
  const palabras = texto.split(/\s+/).filter(Boolean);
  clearTimeout(ocultarSubtitulo);
  el.classList.add('visible');
  return (progreso) => {
    const dichas = Math.max(1, Math.ceil(progreso * palabras.length));
    const desde = Math.max(0, dichas - 14);
    el.innerHTML = '';
    const ya = document.createElement('span');
    ya.textContent = palabras.slice(desde, dichas).join(' ');
    const resto = document.createElement('span');
    resto.className = 'pendiente';
    resto.textContent = dichas < palabras.length ? ` ${palabras.slice(dichas, Math.min(palabras.length, dichas + 3)).join(' ')}` : '';
    el.append(ya, resto);
    if (progreso >= 1) ocultarSubtitulo = setTimeout(() => el.classList.remove('visible'), 2500);
  };
}

// Subtítulos: cada palabra se ilumina cuando la dice
function prepararSubtitulos(el, texto) {
  if (!el || !el.isConnected) return () => {};
  const partes = texto.split(/(\s+)/);
  const total = texto.length || 1;
  const spans = [];
  let acumulado = 0;
  el.textContent = '';
  for (const p of partes) {
    if (/^\s+$/.test(p)) { el.append(p); acumulado += p.length; continue; }
    const sp = document.createElement('span');
    sp.className = 'palabra';
    sp.textContent = p;
    sp.dataset.desde = String(acumulado / total);
    acumulado += p.length;
    el.append(sp);
    spans.push(sp);
  }
  el.classList.add('subtitulada');
  return (progreso) => {
    for (const sp of spans) {
      const desde = Number(sp.dataset.desde);
      sp.classList.toggle('dicha', desde <= progreso);
    }
    if (progreso >= 1) el.classList.remove('subtitulada');
  };
}

async function hablarPiper(limpio, burbuja, miTurno) {
  sintetizando = true;
  const r = await api.sintetizar(limpio);
  sintetizando = false;
  if (miTurno !== turnoVoz) return true;                 // lo cortaron mientras se generaba
  if (!r.ok) {
    if (!avisoPiper) { chip(`✗ Voz neuronal no disponible (${r.error}). Uso la voz de Windows.`, true); avisoPiper = true; }
    return false;
  }
  if (!vozJ) { const { VozJarvis } = await import('./voz-jarvis.js'); vozJ = new VozJarvis(); }
  const subtitular = prepararSubtitulos(burbuja, limpio);
  const subOrbe = subtituloOrbe(limpio);
  await vozJ.reproducir(r.pcm, r.tasa, {
    tono: cfg.tonoVoz || 0.96,
    efecto: cfg.efectoVoz || 'holografico',
    alEmpezar: () => setEstado('hablando'),
    alCuadro: (a, progreso) => {
      orbe.setAmplitud(a.volumen * 0.7);
      orbe.setBandas?.(a);
      if (a.onda) orbe.setOnda?.(a.onda);
      subtitular(progreso);
      subOrbe(progreso);
    },
  });
  subtitular(1);
  subOrbe(1);
  return true;
}

function hablarSistema(limpio, burbuja) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(limpio);
    if (vozElegida) { u.voice = vozElegida; u.lang = vozElegida.lang; } else { u.lang = 'es-AR'; }
    u.rate = cfg.velocidadVoz || 1;
    const subtitular = prepararSubtitulos(burbuja, limpio);
    const subOrbe = subtituloOrbe(limpio);
    u.onstart = () => setEstado('hablando');
    // En cada palabra: pulso en el núcleo + subtítulo
    u.onboundary = (e) => {
      orbe.setAmplitud(0.55 + Math.random() * 0.45);
      orbe.setBandas?.({ graves: 0.4 + Math.random() * 0.4, medios: 0.5 + Math.random() * 0.4, agudos: Math.random() * 0.6 });
      subtitular((e.charIndex || 0) / limpio.length);
      subOrbe((e.charIndex || 0) / limpio.length);
    };
    u.onend = u.onerror = () => { subtitular(1); subOrbe(1); resolve(); };
    speechSynthesis.speak(u);
  });
}

// Devuelve una promesa que se cumple cuando termina de hablar
async function hablar(texto, { burbuja } = {}) {
  if (!vozActiva || !cfg.voz || !texto) return;
  const limpio = texto.replace(/\p{Extended_Pictographic}/gu, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
  if (!limpio) return;
  callar();
  const miTurno = turnoVoz;
  try {
    const listo = cfg.motorVoz !== 'sistema' && await hablarPiper(limpio, burbuja, miTurno);
    if (!listo && miTurno === turnoVoz) await hablarSistema(limpio, burbuja);
  } finally {
    setTimeout(volverAReposo, 150);
  }
}

// ---------------- Comando de voz ----------------
let mic = null;
let escuchandoAhora = false;
let ultimoErrorMic = 0;

const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

// Frases que Whisper "alucina" cuando solo hay silencio o ruido
const ALUCINACIONES = ['gracias', 'gracias por ver', 'subtitulos realizados por la comunidad de amara org', 'suscribete', 'musica', 'aplausos', 'risas', 'gracias por ver el video'];
const esRuido = (t) => { const n = normalizar(t); return n.length < 2 || ALUCINACIONES.includes(n); };

// Modo de activación sin teclado: 'aplausos', 'frase', 'ambos' o 'ninguna'
function modoActivacion() {
  if (!cfg.vozEntrada) return 'ninguna';
  if (cfg.activacion) return cfg.activacion;
  return cfg.escuchaContinua ? 'frase' : 'ninguna';   // compatibilidad con configs viejas
}
const micPermanente = () => modoActivacion() !== 'ninguna';
const conAplausos = () => ['aplausos', 'ambos'].includes(modoActivacion());
const conFrase = () => ['frase', 'ambos'].includes(modoActivacion());

async function obtenerMic() {
  if (!mic) {
    const { Microfono } = await import('./microfono.js');
    mic = new Microfono({
      alNivel: (rms) => { if (orbe.estado === 'escuchando') orbe.setAmplitud(Math.min(1, rms * 14)); },
      alAplauso: () => { if (conAplausos()) activar('aplausos'); },
      sensibilidad: Number(cfg.sensibilidadAplausos) || 1,
    });
  }
  return mic;
}

// Escucha una frase y la devuelve como texto (o null)
async function escucharUnaVez({ esperaInicioMs = 6000 } = {}) {
  if (!cfg.vozEntrada) return null;
  const m = await obtenerMic();
  callar();
  try {
    await m.abrir();
  } catch (err) {
    ultimoErrorMic = Date.now();
    chip(`✗ no pude abrir el micrófono: ${err.message}`, true);
    return null;
  }
  setEstado('escuchando');
  const audio = await m.escucharFrase({ esperaInicioMs });
  if (!micPermanente()) m.cerrar();                 // el micrófono no queda abierto si no hace falta
  if (!audio) { volverAReposo(); return null; }
  setEstado('pensando');
  const r = await api.transcribir(audio);
  if (!r.ok) { chip(`✗ ${r.error}`, true); setEstado('error'); return null; }
  return esRuido(r.texto) ? null : r.texto;
}

// Atajo de teclado o botón 🎙: escucha una orden
async function pulsarParaHablar() {
  if (escuchandoAhora) { mic?.cancelar(); return; }   // segunda pulsación = cancelar
  if (ocupado) return;
  escuchandoAhora = true;
  mic?.cancelar();                                       // pausa la escucha de fondo, si está activa
  try {
    const texto = await escucharUnaVez();
    if (texto) conversar(texto, { porVoz: true }); else volverAReposo();
  } finally {
    escuchandoAhora = false;
  }
}

// Sonido corto de "te escuché" (dos tonos, generado al vuelo, sin archivos)
function campanita() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.18);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* sin audio */ }
}

const RESPUESTAS_ACTIVACION = ['¿Sí, señor?', 'Lo escucho.', 'Aquí estoy.', '¿En qué lo ayudo?', 'Dígame.'];

// Activación por aplausos o por "Hola Jarvis" sin orden: responde y escucha la orden
async function activar(origen) {
  if (ocupado || escuchandoAhora || estaHablando() || document.querySelector('.permiso')) return;
  escuchandoAhora = true;
  mic?.cancelar();                       // corta la espera de fondo para usar el micrófono
  try {
    campanita();
    setEstado('alerta');
    if (origen === 'aplausos') chip('👏👏 activado');
    await hablar(RESPUESTAS_ACTIVACION[Math.floor(Math.random() * RESPUESTAS_ACTIVACION.length)]);
    const texto = await escucharUnaVez({ esperaInicioMs: 7000 });
    if (texto) conversar(texto, { porVoz: true }); else volverAReposo();
  } finally {
    escuchandoAhora = false;
  }
}

// Busca el nombre (ej. "Jarvis") en lo que dijiste y devuelve la orden que sigue.
// null = no te dirigiste a Jarvis; '' = solo dijiste "Jarvis" u "Hola Jarvis".
function extraerOrden(texto) {
  const nombre = normalizar(cfg.nombre || 'Jarvis');
  const variantes = new Set([nombre]);
  if (nombre === 'jarvis') ['yarvis', 'harvis', 'jarbis', 'charvis', 'jervis', 'yervis', 'garvis', 'jarvi'].forEach((v) => variantes.add(v));
  const palabras = String(texto).split(/\s+/);
  const i = palabras.findIndex((p) => variantes.has(normalizar(p)));
  if (i < 0) return null;
  return palabras.slice(i + 1).join(' ').replace(/^[\s,.:;!¡?¿]+/, '').trim();
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Escucha de fondo. Ahorro de recursos:
//  · Los aplausos se detectan midiendo volumen: no transcribe nada.
//  · Para "Hola Jarvis" solo transcribe frases CORTAS (hasta ~6 s); charlas largas,
//    tele o música se descartan sin procesar.
//  · Se pausa mientras Jarvis habla, piensa o espera una autorización.
async function bucleEscucha() {
  const m = await obtenerMic();
  try { await m.abrir(); } catch (err) { chip(`✗ micrófono: ${err.message}`, true); return; }
  const nombre = cfg.nombre || 'Jarvis';
  const formas = { aplausos: 'dos aplausos 👏👏', frase: `«Hola ${nombre}»`, ambos: `dos aplausos 👏👏 o «Hola ${nombre}»` };
  burbuja('sistema', `Escucha activa: ${formas[modoActivacion()]} para llamarme.`);

  while (micPermanente()) {
    if (!conFrase() || ocupado || escuchandoAhora || estaHablando() || document.querySelector('.permiso')) {
      await esperar(400);
      continue;
    }
    const audio = await m.escucharFrase({ esperaInicioMs: 0, maxSeg: 6, silencioMs: 700 });
    if (!audio || ocupado || escuchandoAhora || estaHablando()) continue;
    if (audio.length / 16000 > 5.8) continue;          // demasiado larga para ser una orden: se descarta
    const r = await api.transcribir(audio);
    if (!r.ok) { chip(`✗ ${r.error}`, true); await esperar(5000); continue; }
    if (esRuido(r.texto)) continue;
    const orden = extraerOrden(r.texto);
    if (orden === null) continue;
    if (orden && !/^(hola|hey|che|oye|ey)$/i.test(normalizar(orden))) { campanita(); conversar(orden, { porVoz: true }); continue; }
    await activar('frase');
  }
  m.cerrar();
}

// ---------------- Cerebro ----------------
async function pedirRespuesta() {
  setEstado('pensando');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const burb = burbuja('jarvis vacio', '▍');
  let crudo = '';

  flujos.set(id, (delta) => {
    crudo += delta;
    const visible = limpiar(crudo);
    if (visible) {
      burb.classList.remove('vacio');
      burb.textContent = visible;
      if (orbe.estado !== 'hablando') setEstado('hablando');
      orbe.setAmplitud(0.45);
      bajar();
    }
  });

  const inicio = performance.now();
  let primerToken = 0;
  const flujoOriginal = flujos.get(id);
  flujos.set(id, (d) => { if (!primerToken) { primerToken = performance.now(); $('#p-latencia').textContent = `LAT ${Math.round(primerToken - inicio)} ms`; } flujoOriginal(d); });

  let nativas = usarHerramientas();
  let r = await api.chat(id, [{ role: 'system', content: await api.prompt({ nativas }) }, ...mensajesPara(nativas)], nativas);
  if (!r.ok && r.sinHerramientas) {
    // El servidor no soporta herramientas nativas: sigo con el formato de texto
    herramientasDisponibles = false;
    nativas = false;
    r = await api.chat(id, [{ role: 'system', content: await api.prompt({ nativas }) }, ...mensajesPara(nativas)], false);
  }
  flujos.delete(id);

  if (!r.ok) {
    burb.className = 'msg jarvis error';
    burb.textContent = r.error;
    setEstado('error');
    return { error: true };
  }
  crudo = r.texto || crudo;
  const visible = limpiar(crudo);
  if (!visible) burb.remove(); else burb.textContent = visible;
  return { crudo, visible, burb, llamadas: r.llamadas || [] };
}

// ---------------- Herramientas nativas (function calling) ----------------
let herramientasDisponibles = true;
const usarHerramientas = () => cfg.herramientasNativas !== false && herramientasDisponibles;

// Historial listo para enviar: recortado sin dejar resultados huérfanos, y
// traducido al formato de texto si el servidor no soporta herramientas.
function mensajesPara(nativas) {
  let lista = historial.slice(-(cfg.maxHistorial || 12));
  while (lista.length && lista[0].role === 'tool') lista = lista.slice(1);
  if (nativas) return lista.map(({ nombre, ...m }) => m);   // 'nombre' es solo para uso interno
  return lista.map((m) => {
    if (m.role === 'tool') return { role: 'user', content: `[RESULTADO de ${m.nombre || 'acción'}]\n${m.content}` };
    if (m.tool_calls) return { role: 'assistant', content: m.content || '(usé una acción)' };
    return m;
  });
}

function leerArgumentos(texto) {
  try { const a = JSON.parse(texto || '{}'); return a && typeof a === 'object' ? a : {}; } catch { return {}; }
}

// ---------------- Control de pantalla: indicador y parada ----------------
// El permiso lo administra la guardia (proceso principal). Acá solo se muestra
// el borde ámbar mientras Jarvis usa mouse/teclado, y Ctrl+Shift+X lo corta.
let detenido = false;
let apagarIndicador = null;
let pedidoActual = '';

function indicadorControl() {
  document.body.classList.add('control');
  $('#control-badge').textContent = 'CONTROL ACTIVO';
  $('#control-badge').title = 'Ctrl+Shift+X para cortar el control';
  clearTimeout(apagarIndicador);
  apagarIndicador = setTimeout(() => document.body.classList.remove('control'), 15000);
}

api.onDetenerControl(() => {
  detenido = true;
  callar();
  clearTimeout(apagarIndicador);
  document.body.classList.remove('control');
  chip('⏹ Control detenido', true);
});

async function correrAccion(tipo, args) {
  const meta = tipo && acciones[tipo];
  if (!meta) {
    chip(`✗ acción desconocida: ${tipo || 'formato inválido'}`, true);
    return { tipo, resultado: `La acción "${tipo}" no existe o el formato JSON es inválido.`, devolver: true };
  }
  if (meta.control && detenido) return { tipo, resultado: 'El usuario DETUVO el control de pantalla. No sigas manejando la pantalla.', devolver: true };

  // La guardia decide si hace falta permiso (y de qué tipo)
  let autorizacion = null;
  const ev = cfg.modoAutonomo ? { requiere: false } : await api.evaluar(tipo, args);
  if (ev.bloqueado) { chip(`✗ ${ev.bloqueado}`, true); return { tipo, resultado: ev.bloqueado, devolver: true }; }
  if (ev.requiere) {
    autorizacion = await pedirPermiso(tipo, args, meta, ev);
    if (!autorizacion.ok) {
      chip(`✗ ${ev.motivo || tipo}: denegado`, true);
      return { tipo, resultado: 'El usuario NO autorizó esta acción. No insistas ni busques otra forma de hacerla.', devolver: true };
    }
    if (autorizacion.recordar) chip(`🛡 Permiso recordado: ${ev.categoria === 'control' ? 'control de pantalla' : tipo.replaceAll('_', ' ')}`);
  }

  if (meta.control) indicadorControl();
  setEstado('pensando');
  const r = await api.ejecutar(tipo, args, autorizacion);
  if (r.sospechoso) {
    chip(`🛡 Posible instrucción maliciosa en «${tipo.replaceAll('_', ' ')}». La ignoré: todo lo sensible va a pedir tu confirmación.`, true);
  }
  const etiqueta = r.ok ? (meta.devuelveDatos ? `✓ ${tipo.replaceAll('_', ' ')}` : `✓ ${r.resultado}`) : `✗ ${tipo}: ${r.resultado}`;
  chip(etiqueta, !r.ok);
  // Las acciones de control devuelven el resultado al modelo para que siga con el próximo paso
  return { tipo, resultado: r.resultado, devolver: meta.devuelveDatos || meta.control || !r.ok };
}

async function conversar(texto, { oculto = false, proactivo = false, porVoz = false } = {}) {
  if (ocupado || !texto.trim()) return;
  ocupado = true;
  let huboError = false;
  cfg = await api.config();

  historial.push({ role: 'user', content: texto });
  if (!oculto) burbuja('usuario', texto);
  detenido = false;
  pedidoActual = oculto ? '' : texto;
  await api.nuevoTurno({ proactivo: proactivo || oculto, porVoz });

  try {
    // Manejar la pantalla lleva más pasos (leer → clic → verificar), así que permite más vueltas
    for (let vuelta = 0; vuelta < 14; vuelta++) {
      if (detenido) break;
      const r = await pedirRespuesta();
      if (r.error) { huboError = true; historial.pop(); break; }

      if (proactivo && /^\s*NADA\W*$/i.test(r.visible)) {
        r.burb?.remove();
        historial.pop();
        break;
      }

      const nativas = r.llamadas.length > 0;
      historial.push(nativas
        ? { role: 'assistant', content: r.crudo || '', tool_calls: r.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.name, arguments: l.arguments || '{}' } })) }
        : { role: 'assistant', content: r.crudo });
      if (r.visible) {
        // Si le hablaste con el panel cerrado, contesta en voz alta sin abrirlo
        if (proactivo || (porVoz && !(vozActiva && cfg.voz))) expandir();
        hablar(r.visible, { burbuja: r.burb });
      }

      // Acciones: llamadas nativas (estructuradas) o, si no hay, el formato de texto
      const lista = nativas
        ? r.llamadas.map((l) => ({ tipo: l.name, args: leerArgumentos(l.arguments), id: l.id }))
        : extraerAcciones(r.crudo);
      if (!lista.length) break;

      const resultados = [];
      for (const { tipo, args, id } of lista) resultados.push({ ...(await correrAccion(tipo, args)), id });

      if (nativas) {
        // Cada llamada necesita su resultado en el historial
        for (const x of resultados) historial.push({ role: 'tool', tool_call_id: x.id, nombre: x.tipo, content: String(x.resultado ?? '') });
        if (!resultados.some((x) => x.devolver)) break;
        continue;
      }

      const paraElModelo = resultados.filter((x) => x.devolver);
      if (!paraElModelo.length) break;
      historial.push({
        role: 'user',
        content: `[RESULTADOS DE ACCIONES]\n${paraElModelo.map((x) => `- ${x.tipo}: ${x.resultado}`).join('\n')}\nSi la tarea sigue, hacé el próximo paso; si ya terminó, respondé al usuario en una o dos frases.`,
      });
    }
  } finally {
    ocupado = false;
    ultimaActividad = Date.now();
    if (!huboError) volverAReposo();
    api.guardarHistorial(historial);
  }
}

// ---------------- Avisos desde el proceso principal (recordatorios) ----------------
api.onDecir(({ texto, estado }) => {
  expandir();
  const globo = burbuja('jarvis', texto);
  historial.push({ role: 'assistant', content: texto });
  api.guardarHistorial(historial);
  setEstado(estado || 'alerta');
  hablar(texto, { burbuja: globo });
  setTimeout(volverAReposo, 4000);
});

api.onEscuchar(() => pulsarParaHablar());
api.onAviso((msg) => burbuja('sistema', msg));

api.onEnfocar(() => {
  expandir();
  setTimeout(() => $('#entrada').focus(), 80);
});

// ---------------- Controles ----------------
$('#formulario').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#entrada').value;
  $('#entrada').value = '';
  callar();
  conversar(t);
});

$('#zona-orbe').addEventListener('click', () => {
  if (document.body.classList.contains('compacto')) {
    expandir();
    setTimeout(() => $('#entrada').focus(), 80);
  } else {
    compactar();
  }
});

$('#b-compactar').onclick = compactar;
$('#b-mic').onclick = () => pulsarParaHablar();
$('#b-carpeta').onclick = () => api.abrirCarpeta();
$('#b-escudo').onclick = async () => {
  expandir();
  document.querySelector('.panel-permisos')?.remove();
  const lista = await api.permisos();
  const nombres = { control: 'Controlar mouse y teclado', leer_archivo: 'Leer archivos', escribir_archivo: 'Escribir archivos', mover_archivo: 'Mover archivos', enviar_a_papelera: 'Mandar a la papelera', cerrar_programa: 'Cerrar programas', energia: 'Apagar / reiniciar / suspender', leer_portapapeles: 'Leer el portapapeles' };
  const caja = document.createElement('div');
  caja.className = 'panel-permisos';
  const texto = document.createElement('div');
  texto.textContent = lista.length
    ? 'Estas acciones ya no te piden permiso (salvo después de leer contenido externo):'
    : 'No hay permisos recordados. Mensajes, compras, datos personales y PowerShell se consultan siempre.';
  caja.append(texto);
  if (lista.length) {
    const ul = document.createElement('ul');
    lista.forEach((p) => { const li = document.createElement('li'); li.textContent = nombres[p] || p; ul.append(li); });
    const b = Object.assign(document.createElement('button'), { textContent: 'OLVIDAR TODOS' });
    b.onclick = async () => { await api.revocarPermisos(); caja.remove(); chip('🛡 Permisos olvidados: todo vuelve a preguntar.'); };
    caja.append(ul, b);
  }
  $('#chat').appendChild(caja);
  bajar();
};
$('#b-voz').onclick = () => {
  vozActiva = !vozActiva;
  $('#b-voz').textContent = vozActiva ? '🔊' : '🔇';
  if (!vozActiva) callar();
};
$('#b-limpiar').onclick = () => {
  historial = [];
  $('#chat').innerHTML = '';
  api.guardarHistorial(historial);
  burbuja('sistema', 'Conversación borrada. La memoria a largo plazo se mantiene.');
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') compactar(); });

// ---------------- Vida propia: proactividad y auto-compactar ----------------
setInterval(() => {
  const ahora = Date.now();
  const espera = (cfg.minutosProactivo || 40) * 60000;

  if (cfg.proactivo && !ocupado && ahora - ultimaActividad > espera && ahora - ultimoProactivo > espera) {
    ultimoProactivo = ahora;
    const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const minutos = Math.round((ahora - ultimaActividad) / 60000);
    conversar(
      `[MODO PROACTIVO] Son las ${hora}. Hace ${minutos} minutos que tu usuario no te habla. `
      + 'Si tenés algo genuinamente útil, interesante o con tu personalidad para decirle '
      + '(algo de tu memoria, una sugerencia, un comentario sobre la hora o el día), decilo en una o dos frases. '
      + 'Podés usar acciones si tiene sentido. Si no tenés nada valioso, respondé exactamente: NADA',
      { oculto: true, proactivo: true },
    );
  }

  const expandida = document.body.classList.contains('expandido');
  if (expandida && !ocupado && !document.hasFocus() && !document.querySelector('.permiso') && ahora - ultimaActividad > 90000) {
    compactar();
  }
}, 30000);

// ---------------- Telemetría del HUD ----------------
async function actualizarTelemetria() {
  const ahora = new Date();
  $('#t-hora').textContent = ahora.toLocaleTimeString('es-AR', { hour12: false });
  $('#rc-hora').textContent = ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  $('#rc-seg').textContent = String(ahora.getSeconds()).padStart(2, '0');
  $('#t-fecha').textContent = ahora.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
  if (!document.body.classList.contains('expandido') || !api.telemetria) return;
  const t = await api.telemetria();
  $('#t-cpu').textContent = `${t.cpu}%  ·  ${t.nucleos} NÚC`;
  $('#b-cpu').style.width = `${t.cpu}%`;
  $('#t-ram').textContent = `${t.ramUsada.toFixed(1)} / ${t.ramTotal.toFixed(0)} GB`;
  $('#b-ram').style.width = `${(t.ramUsada / t.ramTotal) * 100}%`;
  $('#t-up').textContent = `ACTIVO ${t.horasEncendida.toFixed(1)} H`;
}
setInterval(actualizarTelemetria, 1000);

// ---------------- Encendido ----------------
// Las partículas llegan dispersas y se juntan, el nombre se "descifra" y sube el nivel de energía
function secuenciaEncendido() {
  return new Promise((resolve) => {
    document.body.classList.add('encendiendo');
    orbe.setEstado('arranque');
    descifrar($('#ar-nombre'), (cfg.nombre || 'Jarvis').toUpperCase());
    const inicio = performance.now();
    const DURACION = 2400;
    const paso = () => {
      const p = Math.min(1, (performance.now() - inicio) / DURACION);
      const suave = 1 - (1 - p) ** 3;
      $('#ar-barra').style.width = `${suave * 100}%`;
      $('#ar-pct').textContent = `${(suave * 100).toFixed(1)}%`;
      if (p < 1) return requestAnimationFrame(paso);
      setEstado('inactivo');
      setTimeout(() => { document.body.classList.remove('encendiendo'); resolve(); }, 450);
    };
    requestAnimationFrame(paso);
  });
}

// ---------------- Inicio ----------------
(async function iniciar() {
  cfg = await api.config();
  await crearOrbe();
  requestAnimationFrame(() => document.body.classList.remove('arrancando'));
  acciones = await api.acciones();
  historial = await api.historial();
  try {
    const url = new URL(cfg.endpoint);
    $('#p-enlace').textContent = `ENLACE ${url.host}`;
  } catch { $('#p-enlace').textContent = 'ENLACE ?'; }
  $('#p-modelo').textContent = `MODELO ${cfg.modelo || '?'}`;
  actualizarTelemetria();
  await secuenciaEncendido();
  vozActiva = cfg.voz !== false;
  $('#b-voz').textContent = vozActiva ? '🔊' : '🔇';
  $('#nombre').textContent = (cfg.nombre || 'Jarvis').toUpperCase();
  document.title = cfg.nombre || 'Jarvis';
  elegirVoz();
  $('#b-mic').hidden = cfg.vozEntrada === false;
  $('#entrada').placeholder = cfg.vozEntrada === false ? 'Escribí una orden…' : 'Escribí una orden o apretá 🎙';

  // Mostrar las últimas líneas de la conversación anterior
  historial.slice(-12).forEach((m) => {
    if (m.role === 'user' && !m.content.startsWith('[')) burbuja('usuario', m.content);
    if (m.role === 'assistant') { const v = limpiar(m.content); if (v) burbuja('jarvis', v); }
  });

  const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  conversar(
    `[INICIO] Acabás de encenderte; son las ${hora}. Saludá a tu usuario en una sola frase, con tu personalidad. No uses acciones.`,
    { oculto: true },
  );

  if (micPermanente()) bucleEscucha();
}());
