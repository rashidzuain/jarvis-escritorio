// =====================================================================
//  VOZ DE JARVIS (texto → audio), 100% local con Piper
//  · La primera vez descarga Piper (programa oficial, GitHub) y la voz
//    elegida (Hugging Face). Después funciona sin internet.
//  · Corre en el procesador: deja la placa de video libre para el cerebro.
//  · Devuelve audio crudo (PCM 16 bits mono); el efecto "Jarvis" y la
//    animación se aplican en la interfaz.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const URL_PIPER = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const BASE_VOCES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

let preparando = null;

async function descargar(url, destino) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`no pude descargar ${path.basename(destino)} (HTTP ${res.status})`);
  const temporal = `${destino}.parcial`;
  fs.writeFileSync(temporal, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(temporal, destino);
}

function correr(cmd, args, opciones = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opciones });
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `código ${c}`))));
  });
}

// "es_MX-ald-medium" → carpeta y URL de Hugging Face
function rutaVoz(id) {
  const m = /^([a-z]{2})_([A-Z]{2})-([\w-]+)-(x_low|low|medium|high)$/.exec(id);
  if (!m) throw new Error(`nombre de voz inválido: ${id}`);
  const [, idioma, pais, nombre, calidad] = m;
  return `${BASE_VOCES}/${idioma}/${idioma}_${pais}/${nombre}/${calidad}/${id}`;
}

async function preparar({ carpeta, voz, avisar }) {
  const dir = path.join(carpeta, 'voz');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
  if (!fs.existsSync(exe)) {
    if (process.platform !== 'win32') throw new Error('la descarga automática de Piper es solo para Windows');
    avisar?.('Descargando el motor de voz (solo la primera vez)…');
    const zip = path.join(dir, 'piper.zip');
    await descargar(URL_PIPER, zip);
    await correr('tar', ['-xf', zip, '-C', dir]);          // tar viene incluido en Windows 10/11
    fs.unlinkSync(zip);
  }
  const modelo = path.join(dir, `${voz}.onnx`);
  if (!fs.existsSync(modelo) || !fs.existsSync(`${modelo}.json`)) {
    avisar?.(`Descargando la voz ${voz} (unos 60 MB, solo la primera vez)…`);
    const base = rutaVoz(voz);
    await descargar(`${base}.onnx.json`, `${modelo}.json`);
    await descargar(`${base}.onnx`, modelo);
  }
  const tasa = JSON.parse(fs.readFileSync(`${modelo}.json`, 'utf8'))?.audio?.sample_rate || 22050;
  return { exe, modelo, tasa };
}

// Deja el texto listo para decirse en voz alta
function limpiarParaVoz(texto) {
  return String(texto || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/https?:\/\/\S+/g, 'el enlace')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Devuelve { pcm: Buffer (int16 mono), tasa } */
async function sintetizar(texto, { carpeta, voz = 'es_MX-ald-medium', velocidad = 1, avisar }) {
  const limpio = limpiarParaVoz(texto);
  if (!limpio) return { pcm: Buffer.alloc(0), tasa: 22050 };
  if (!preparando || preparando.voz !== voz) {
    preparando = { voz, promesa: preparar({ carpeta, voz, avisar }) };
    preparando.promesa.catch(() => { preparando = null; });
  }
  const { exe, modelo, tasa } = await preparando.promesa;

  return new Promise((resolve, reject) => {
    const largo = (1 / Math.min(2, Math.max(0.5, Number(velocidad) || 1))).toFixed(2);
    const p = spawn(exe, ['--model', modelo, '--output_raw', '--length_scale', largo, '--sentence_silence', '0.15'], {
      cwd: path.dirname(exe), windowsHide: true,
    });
    const partes = [];
    let err = '';
    p.stdout.on('data', (d) => partes.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => {
      if (c !== 0) return reject(new Error(err.trim().split('\n').pop() || `Piper terminó con código ${c}`));
      resolve({ pcm: Buffer.concat(partes), tasa });
    });
    p.stdin.end(`${limpio}\n`, 'utf8');
  });
}

module.exports = { sintetizar };
