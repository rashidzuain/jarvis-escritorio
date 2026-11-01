// =====================================================================
//  ACCIONES — la "agencia" de Jarvis.
//  Cada acción es un objeto con:
//    descripcion   → qué hace (el modelo lo lee para decidir cuándo usarla)
//    params        → { nombre: 'explicación' } que el modelo debe completar
//    peligrosa     → true = te pide permiso antes (salvo modoAutonomo)
//    devuelveDatos → true = el resultado vuelve al modelo para que lo use
//    ejecutar      → async (args) => 'texto con el resultado'
//
//  Para agregar una funcionalidad nueva, copiá un bloque, cambiale el
//  nombre y reiniciá la app. Jarvis la va a conocer automáticamente.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const esWindows = process.platform === 'win32';

// Nombres comunes → lo que entiende Windows con "start"
const ALIAS_APPS = {
  'calculadora': 'calc',
  'bloc de notas': 'notepad',
  'notas': 'notepad',
  'paint': 'mspaint',
  'explorador': 'explorer',
  'archivos': 'explorer',
  'configuracion': 'ms-settings:',
  'configuración': 'ms-settings:',
  'administrador de tareas': 'taskmgr',
  'terminal': 'wt',
  'cmd': 'cmd',
  'powershell': 'powershell',
  'spotify': 'spotify:',
  'whatsapp': 'whatsapp:',
  'discord': 'discord:',
  'steam': 'steam:',
  'correo': 'outlookmail:',
  'camara': 'microsoft.windows.camera:',
  'cámara': 'microsoft.windows.camera:',
  'word': 'winword',
  'excel': 'excel',
  'vscode': 'code',
  'visual studio code': 'code',
};

const recortar = (s, n = 3000) => (s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);
const expandirRuta = (r) => path.resolve(String(r || '').replace(/^~(?=$|[\\/])/, require('os').homedir()));

function correr(comando, entrada, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const p = esWindows
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true })
      : spawn('bash', ['-s']);
    let out = '';
    const t = setTimeout(() => { p.kill(); out += '\n(cortado por tiempo)'; }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(t); resolve(`código ${code}\n${recortar(out.trim() || '(sin salida)')}`); });
    p.stdin.write(`${entrada ?? comando}\n`);
    p.stdin.end();
  });
}

module.exports = function crearAcciones({ shell, clipboard, os, desktopCapturer, screen, carpetaDatos, programarRecordatorio, control, verPantalla, pasarClics }) {
  const archivo = (n) => path.join(carpetaDatos, n);
  const marcaDeTiempo = () => new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  return {
    // ---------------- Navegación y apps ----------------
    abrir_url: {
      descripcion: 'Abre una página web en el navegador',
      params: { url: 'dirección web' },
      async ejecutar({ url }) {
        if (!url) throw new Error('falta la url');
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        await shell.openExternal(url);
        return `Abrí ${url}`;
      },
    },

    buscar_web: {
      descripcion: 'Busca algo en Google y abre los resultados en el navegador',
      params: { consulta: 'qué buscar' },
      async ejecutar({ consulta }) {
        await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(consulta || '')}`);
        return `Busqué "${consulta}"`;
      },
    },

    buscar_youtube: {
      descripcion: 'Busca un video o canción en YouTube',
      params: { consulta: 'qué buscar' },
      async ejecutar({ consulta }) {
        await shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(consulta || '')}`);
        return `Busqué "${consulta}" en YouTube`;
      },
    },

    abrir_app: {
      descripcion: 'Abre un programa de la computadora (ej: calculadora, spotify, bloc de notas, word, chrome, discord)',
      params: { nombre: 'nombre del programa' },
      ejecutar({ nombre }) {
        const pedido = String(nombre || '').trim();
        const real = ALIAS_APPS[pedido.toLowerCase()] || pedido;
        const limpio = real.replace(/["&|<>^%]/g, '');
        if (!limpio) throw new Error('falta el nombre');
        return new Promise((resolve, reject) => {
          const cmd = esWindows ? `start "" "${limpio}"` : `xdg-open "${limpio}"`;
          exec(cmd, { windowsHide: true }, (err) => (err ? reject(new Error(`no pude abrir "${pedido}"`)) : resolve(`Abrí ${pedido}`)));
        });
      },
    },

    abrir_carpeta: {
      descripcion: 'Abre una carpeta o archivo con su programa predeterminado. Atajos válidos: escritorio, descargas, documentos, imagenes, musica, videos',
      params: { ruta: 'ruta o atajo' },
      async ejecutar({ ruta }) {
        const atajos = { escritorio: 'Desktop', descargas: 'Downloads', documentos: 'Documents', imagenes: 'Pictures', imágenes: 'Pictures', musica: 'Music', música: 'Music', videos: 'Videos' };
        const clave = String(ruta || '').toLowerCase();
        const final = atajos[clave] ? path.join(os.homedir(), atajos[clave]) : expandirRuta(ruta);
        const err = await shell.openPath(final);
        if (err) throw new Error(err);
        return `Abrí ${final}`;
      },
    },

    // ---------------- Tiempo y organización ----------------
    recordatorio: {
      descripcion: 'Programa un recordatorio: dentro de X minutos aparece una notificación y lo decís en voz alta',
      params: { minutos: 'número de minutos', texto: 'qué recordar' },
      async ejecutar({ minutos, texto }) {
        const m = Number(minutos);
        if (!Number.isFinite(m) || m <= 0) throw new Error('minutos inválidos');
        const r = programarRecordatorio(m, texto || 'Recordatorio');
        const hora = new Date(r.cuando).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        return `Recordatorio para las ${hora}: ${texto}`;
      },
    },

    guardar_nota: {
      descripcion: 'Guarda una nota en el anotador del usuario',
      params: { texto: 'contenido de la nota' },
      async ejecutar({ texto }) {
        fs.appendFileSync(archivo('notas.md'), `- [${marcaDeTiempo()}] ${texto}\n`);
        return 'Nota guardada';
      },
    },

    leer_notas: {
      descripcion: 'Lee todas las notas guardadas',
      devuelveDatos: true,
      async ejecutar() {
        const t = fs.readFileSync(archivo('notas.md'), 'utf8').trim();
        return t ? recortar(t, 4000) : '(no hay notas)';
      },
    },

    recordar_dato: {
      descripcion: 'Guarda en tu memoria a largo plazo un dato importante sobre tu usuario (gustos, proyectos, personas, preferencias). Lo vas a recordar siempre',
      params: { dato: 'el dato en una frase' },
      async ejecutar({ dato }) {
        fs.appendFileSync(archivo('memoria.md'), `- ${dato}\n`);
        return 'Guardado en memoria';
      },
    },

    // ---------------- Información ----------------
    info_sistema: {
      descripcion: 'Consulta hora, uso de memoria RAM, procesador y tiempo encendida de la PC',
      devuelveDatos: true,
      async ejecutar() {
        const gb = (b) => (b / 1024 ** 3).toFixed(1);
        return JSON.stringify({
          hora: new Date().toLocaleString('es-AR'),
          sistema: `${os.type()} ${os.release()}`,
          procesador: `${os.cpus()[0]?.model} (${os.cpus().length} núcleos)`,
          ram: `${gb(os.totalmem() - os.freemem())} GB usados de ${gb(os.totalmem())} GB`,
          encendida_hace: `${(os.uptime() / 3600).toFixed(1)} horas`,
        });
      },
    },

    clima: {
      descripcion: 'Consulta el clima actual de una ciudad',
      params: { ciudad: 'nombre de la ciudad' },
      devuelveDatos: true,
      async ejecutar({ ciudad }) {
        const r = await fetch(`https://wttr.in/${encodeURIComponent(ciudad || '')}?format=%l:+%C+%t+(sensación+%f),+viento+%w,+humedad+%h&lang=es`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('no pude consultar el clima');
        return (await r.text()).trim();
      },
    },

    // ---------------- Portapapeles y archivos ----------------
    copiar: {
      descripcion: 'Copia un texto al portapapeles',
      params: { texto: 'texto a copiar' },
      async ejecutar({ texto }) { clipboard.writeText(String(texto ?? '')); return 'Copiado al portapapeles'; },
    },

    leer_portapapeles: {
      descripcion: 'Lee el texto que el usuario tiene copiado',
      peligrosa: true,
      devuelveDatos: true,
      async ejecutar() { return recortar(clipboard.readText() || '(portapapeles vacío)'); },
    },

    listar_carpeta: {
      descripcion: 'Lista los archivos de una carpeta',
      params: { ruta: 'ruta de la carpeta' },
      devuelveDatos: true,
      async ejecutar({ ruta }) {
        const r = expandirRuta(ruta);
        const items = fs.readdirSync(r, { withFileTypes: true }).slice(0, 150);
        return `${r}\n${items.map((i) => `${i.isDirectory() ? '[carpeta]' : '-'} ${i.name}`).join('\n')}`;
      },
    },

    leer_archivo: {
      descripcion: 'Lee el contenido de un archivo de texto',
      params: { ruta: 'ruta del archivo' },
      peligrosa: true,
      devuelveDatos: true,
      async ejecutar({ ruta }) { return recortar(fs.readFileSync(expandirRuta(ruta), 'utf8'), 8000); },
    },

    escribir_archivo: {
      descripcion: 'Crea o sobrescribe un archivo de texto con el contenido indicado',
      params: { ruta: 'ruta del archivo', contenido: 'texto completo' },
      peligrosa: true,
      async ejecutar({ ruta, contenido }) {
        const r = expandirRuta(ruta);
        fs.mkdirSync(path.dirname(r), { recursive: true });
        fs.writeFileSync(r, String(contenido ?? ''));
        return `Escribí ${r}`;
      },
    },

    // ---------------- Control del sistema (sin permiso: no tocan tus datos) ----------------
    multimedia: {
      descripcion: 'Controla la música/video y el volumen. accion: play_pausa, siguiente, anterior, subir_volumen, bajar_volumen o silenciar',
      params: { accion: 'una de las opciones', veces: 'cuántas veces (para el volumen, cada vez es 2%)' },
      async ejecutar({ accion, veces }) {
        const teclas = { play_pausa: 179, siguiente: 176, anterior: 177, subir_volumen: 175, bajar_volumen: 174, silenciar: 173 };
        const codigo = teclas[accion];
        if (!codigo) throw new Error('acción multimedia desconocida');
        const n = Math.min(50, Math.max(1, Number(veces) || (accion.includes('volumen') ? 5 : 1)));
        if (!esWindows) throw new Error('solo disponible en Windows');
        await correr(`$w = New-Object -ComObject WScript.Shell; 1..${n} | % { $w.SendKeys([char]${codigo}) }`);
        return `Listo (${accion.replace('_', ' ')})`;
      },
    },

    bloquear_pc: {
      descripcion: 'Bloquea la sesión de Windows (pantalla de inicio de sesión)',
      async ejecutar() {
        exec('rundll32.exe user32.dll,LockWorkStation', { windowsHide: true });
        return 'PC bloqueada';
      },
    },

    captura_pantalla: {
      descripcion: 'Saca una captura de toda la pantalla y la guarda en Imágenes\\Jarvis',
      async ejecutar() {
        const { width, height } = screen.getPrimaryDisplay().size;
        const factor = screen.getPrimaryDisplay().scaleFactor || 1;
        const [fuente] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: width * factor, height: height * factor } });
        if (!fuente) throw new Error('no pude capturar la pantalla');
        const carpeta = path.join(os.homedir(), 'Pictures', 'Jarvis');
        fs.mkdirSync(carpeta, { recursive: true });
        const archivo = path.join(carpeta, `captura-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
        fs.writeFileSync(archivo, fuente.thumbnail.toPNG());
        return `Captura guardada en ${archivo}`;
      },
    },

    listar_procesos: {
      descripcion: 'Muestra los programas abiertos que más memoria usan',
      devuelveDatos: true,
      async ejecutar() {
        if (!esWindows) return correr('ps -eo comm,rss --sort=-rss | head -12');
        return correr('Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 Name, @{n="MB";e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String -Width 120');
      },
    },

    buscar_archivos: {
      descripcion: 'Busca archivos por nombre dentro de una carpeta (atajos: escritorio, descargas, documentos)',
      params: { carpeta: 'dónde buscar', patron: 'parte del nombre a buscar' },
      devuelveDatos: true,
      async ejecutar({ carpeta, patron }) {
        const atajos = { escritorio: 'Desktop', descargas: 'Downloads', documentos: 'Documents', imagenes: 'Pictures', musica: 'Music', videos: 'Videos' };
        const base = atajos[String(carpeta || '').toLowerCase()] ? path.join(os.homedir(), atajos[String(carpeta).toLowerCase()]) : expandirRuta(carpeta || '~');
        const buscado = String(patron || '').toLowerCase();
        const encontrados = [];
        const recorrer = (dir, nivel) => {
          if (nivel > 4 || encontrados.length >= 40) return;
          let items = [];
          try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const it of items) {
            if (encontrados.length >= 40) return;
            if (it.name.startsWith('.') || it.name === 'node_modules') continue;
            const ruta = path.join(dir, it.name);
            if (it.name.toLowerCase().includes(buscado)) encontrados.push(ruta);
            if (it.isDirectory()) recorrer(ruta, nivel + 1);
          }
        };
        recorrer(base, 0);
        return encontrados.length ? encontrados.join('\n') : `No encontré nada con "${patron}" en ${base}`;
      },
    },

    // ---------------- Acciones sensibles (siempre piden autorización) ----------------
    cerrar_programa: {
      descripcion: 'Cierra un programa abierto por su nombre de proceso (ej: chrome, spotify, notepad)',
      params: { nombre: 'nombre del proceso' },
      peligrosa: true,
      async ejecutar({ nombre }) {
        const limpio = String(nombre || '').replace(/[^\w.\- ]/g, '').replace(/\.exe$/i, '');
        if (!limpio) throw new Error('falta el nombre');
        if (!esWindows) return correr(`pkill -x "${limpio}" && echo cerrado || echo "No encontré ${limpio} abierto"`);
        return correr(`$p = Get-Process -Name "${limpio}" -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process; "Cerré ${limpio}" } else { "No encontré ${limpio} abierto" }`);
      },
    },

    energia: {
      descripcion: 'Apaga, reinicia o suspende la PC, o cancela un apagado programado. accion: apagar, reiniciar, suspender o cancelar',
      params: { accion: 'apagar, reiniciar, suspender o cancelar', minutos: 'espera antes de apagar/reiniciar (por defecto 1)' },
      peligrosa: true,
      async ejecutar({ accion, minutos }) {
        if (!esWindows) throw new Error('solo disponible en Windows');
        const seg = Math.max(0, Math.round((Number(minutos) || 1) * 60));
        const cmds = {
          apagar: `shutdown /s /t ${seg}`,
          reiniciar: `shutdown /r /t ${seg}`,
          suspender: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
          cancelar: 'shutdown /a',
        };
        if (!cmds[accion]) throw new Error('acción de energía desconocida');
        exec(cmds[accion], { windowsHide: true });
        return accion === 'cancelar' ? 'Apagado cancelado' : `${accion} en ${accion === 'suspender' ? 'un instante' : `${seg / 60} min`}`;
      },
    },

    mover_archivo: {
      descripcion: 'Mueve o renombra un archivo o carpeta',
      params: { origen: 'ruta actual', destino: 'ruta nueva' },
      peligrosa: true,
      async ejecutar({ origen, destino }) {
        const o = expandirRuta(origen);
        const d = expandirRuta(destino);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.renameSync(o, d);
        return `Moví ${o} → ${d}`;
      },
    },

    enviar_a_papelera: {
      descripcion: 'Manda un archivo o carpeta a la Papelera de reciclaje (se puede recuperar)',
      params: { ruta: 'ruta del archivo o carpeta' },
      peligrosa: true,
      async ejecutar({ ruta }) {
        const r = expandirRuta(ruta);
        await shell.trashItem(r);
        return `Mandé a la papelera: ${r}`;
      },
    },

    // ---------------- Ver y manejar la pantalla ----------------
    // Flujo: leer_pantalla → clic/teclas/escribir_texto → leer_pantalla para verificar.
    // Las acciones de control (control: true) piden UN permiso por tarea (sesión de unos minutos)
    // y los botones sensibles (comprar, pagar, enviar, eliminar…) se confirman uno por uno.
    leer_pantalla: {
      descripcion: 'Lee la ventana que el usuario tiene abierta: su título y la lista numerada de botones, campos, menús y links. Usala antes de hacer clic',
      devuelveDatos: true,
      async ejecutar() {
        const { titulo, elementos } = await control.leerPantalla();
        if (!elementos.length) return `Ventana: ${titulo || '(sin título)'}\n(No encontré elementos; probá ver_pantalla)`;
        return `Ventana: ${titulo}\n${elementos.map((e, i) => `${i + 1}. [${e.t}] ${e.n || '(sin nombre)'}`).join('\n')}`;
      },
    },

    ver_pantalla: {
      descripcion: 'Mira la pantalla con visión artificial y responde una pregunta sobre lo que se ve (imágenes, gráficos, videos, texto). Más lenta que leer_pantalla',
      params: { pregunta: 'qué querés saber de la pantalla' },
      devuelveDatos: true,
      async ejecutar({ pregunta }) { return verPantalla(pregunta || 'Describí qué hay en la pantalla.'); },
    },

    clic: {
      descripcion: 'Hace clic en un elemento de la ventana activa. Usá el número o el nombre que te dio leer_pantalla',
      params: { elemento: 'número o nombre del elemento', boton: 'izquierdo o derecho (opcional)', veces: '2 para doble clic (opcional)' },
      control: true,
      // Los botones sensibles (comprar, enviar, eliminar…) los frena la guardia de seguridad (seguridad.js)
      async ejecutar({ elemento, x, y, boton, veces }) {
        return pasarClics(() => control.clic({ elemento, x, y, boton, veces }));
      },
    },

    teclas: {
      descripcion: 'Presiona una tecla o combinación en la ventana activa (ej: enter, tab, esc, ctrl+s, ctrl+c, alt+tab, f5)',
      params: { combinacion: 'tecla o combinación', veces: 'cuántas veces (opcional)' },
      control: true,
      async ejecutar(args) { return control.teclas(args); },
    },

    desplazar: {
      descripcion: 'Desplaza (scroll) la ventana que está bajo el mouse',
      params: { direccion: 'arriba o abajo', cantidad: 'cuánto (1 a 30)' },
      control: true,
      async ejecutar(args) { return control.desplazar(args); },
    },

    escribir_texto: {
      descripcion: 'Escribe un texto en la ventana activa, en el campo que tenga el foco (como si lo tipeara)',
      params: { texto: 'texto a escribir' },
      control: true,
      async ejecutar(args) { return control.escribir(args); },
    },

    // ---------------- Poder total (con permiso) ----------------
    ejecutar_powershell: {
      descripcion: 'Ejecuta un comando de PowerShell en la PC y devuelve la salida. Sirve para casi todo: volumen, procesos, archivos, red, etc.',
      params: { comando: 'comando de PowerShell' },
      peligrosa: true,
      devuelveDatos: true,
      async ejecutar({ comando }) {
        if (!comando) throw new Error('falta el comando');
        return correr(comando);
      },
    },
  };
};
