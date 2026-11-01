// =====================================================================
//  VOZ → TEXTO, 100% local (Whisper vía transformers.js)
//  · El modelo se descarga una sola vez (~80 MB) y queda guardado.
//  · Se carga recién la primera vez que hablás, y se libera de la memoria
//    después de unos minutos sin usarlo → no gasta RAM si no usás la voz.
// =====================================================================
const path = require('path');

const MINUTOS_PARA_LIBERAR = 10;

let reconocedor = null;
let cargando = null;
let ultimoUso = 0;

async function cargar({ modelo, carpeta, avisar }) {
  if (reconocedor) return reconocedor;
  if (!cargando) {
    cargando = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.join(carpeta, 'modelos-voz');
      let avisado = false;
      const p = await pipeline('automatic-speech-recognition', modelo, {
        dtype: 'q8',
        progress_callback: (info) => {
          if (!avisado && info.status === 'download') {
            avisado = true;
            avisar?.('Descargando el modelo de voz (solo la primera vez, unos 80 MB)…');
          }
        },
      });
      return p;
    })().catch((err) => { cargando = null; throw err; });
  }
  reconocedor = await cargando;
  return reconocedor;
}

async function transcribir(audio, opciones) {
  const p = await cargar(opciones);
  ultimoUso = Date.now();
  const r = await p(audio, { language: opciones.idioma || 'spanish', task: 'transcribe' });
  ultimoUso = Date.now();
  return String(r?.text || '').trim();
}

// Libera el modelo si no se usa
setInterval(async () => {
  if (reconocedor && Date.now() - ultimoUso > MINUTOS_PARA_LIBERAR * 60000) {
    const viejo = reconocedor;
    reconocedor = null;
    cargando = null;
    try { await viejo.dispose?.(); } catch { /* nada */ }
  }
}, 60000).unref();

module.exports = { transcribir };
