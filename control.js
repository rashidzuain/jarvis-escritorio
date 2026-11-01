// =====================================================================
//  CONTROL DE PANTALLA (Windows)
//  Un único proceso de PowerShell que queda abierto mientras se usa y se
//  cierra solo tras 5 minutos sin uso. Hace tres cosas:
//   · Lee los elementos de la ventana activa (botones, campos, menús, links)
//     con UI Automation, el sistema de accesibilidad de Windows.
//   · Mueve el mouse, hace clic, desplaza y presiona teclas.
//   · Todo con coordenadas físicas (es "consciente" del escalado de pantalla).
// =====================================================================
const { spawn } = require('child_process');

const esWindows = process.platform === 'win32';
const MINUTOS_PARA_CERRAR = 5;

const INICIO = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class JV {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  public static IntPtr H = IntPtr.Zero;
  // La ventana sobre la que trabajar: la activa, salvo que sea Jarvis; en ese caso, la que está justo detrás
  public static IntPtr Objetivo(uint propio) {
    IntPtr h = GetForegroundWindow(); uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid != propio) { H = h; return h; }
    IntPtr c = GetWindow(h, 2);
    while (c != IntPtr.Zero) {
      GetWindowThreadProcessId(c, out pid);
      var sb = new System.Text.StringBuilder(256); GetWindowText(c, sb, 256);
      if (pid != propio && IsWindowVisible(c) && !IsIconic(c) && sb.Length > 0) {
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);   // permite traer la ventana al frente
        SetForegroundWindow(c);
        H = c; return c;
      }
      c = GetWindow(c, 2);
    }
    H = h; return h;
  }
  public static void Clic(int x, int y, string boton, int veces) {
    SetCursorPos(x, y);
    uint abajo = 0x0002, arriba = 0x0004;
    if (boton == "derecho") { abajo = 0x0008; arriba = 0x0010; }
    for (int i = 0; i < veces; i++) { mouse_event(abajo, 0, 0, 0, UIntPtr.Zero); mouse_event(arriba, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); }
  }
  public static void Rueda(int cantidad) { mouse_event(0x0800, 0, 0, cantidad, UIntPtr.Zero); }
  public static string Titulo() { var sb = new System.Text.StringBuilder(512); GetWindowText(H, sb, 512); return sb.ToString(); }
}
"@
[JV]::SetProcessDPIAware() | Out-Null
"listo"
`;

// Lista los elementos interactivos de la ventana activa en JSON
const LEER = String.raw`
$A = [System.Windows.Automation.AutomationElement]
$T = [System.Windows.Automation.ControlType]
$tipos = @($T::Button, $T::Edit, $T::Hyperlink, $T::MenuItem, $T::ListItem, $T::TabItem, $T::CheckBox, $T::ComboBox, $T::RadioButton, $T::TreeItem, $T::SplitButton, $T::Document)
$conds = $tipos | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $_) }
$o = New-Object System.Windows.Automation.OrCondition($conds)
$v = $A::FromHandle([JV]::Objetivo(__PID__))
$lista = New-Object System.Collections.ArrayList
$reloj = [Diagnostics.Stopwatch]::StartNew()
foreach ($e in $v.FindAll([System.Windows.Automation.TreeScope]::Descendants, $o)) {
  if ($lista.Count -ge 90 -or $reloj.ElapsedMilliseconds -gt 4000) { break }
  try {
    $c = $e.Current
    if ($c.IsOffscreen) { continue }
    $r = $c.BoundingRectangle
    if ($r.Width -lt 4 -or $r.Height -lt 4 -or [double]::IsInfinity($r.X)) { continue }
    $n = ($c.Name -replace '\s+', ' ').Trim()
    if ($n.Length -gt 70) { $n = $n.Substring(0, 70) + '…' }
    $tipo = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''
    if (-not $n -and $tipo -ne 'Edit') { continue }
    [void]$lista.Add(@{ n = $n; t = $tipo; x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2) })
  } catch {}
}
@{ titulo = [JV]::Titulo(); elementos = $lista } | ConvertTo-Json -Depth 4 -Compress
`;

class AyudantePS {
  constructor() { this.proc = null; this.cola = Promise.resolve(); this.temporizador = null; }

  iniciar() {
    if (this.proc) return this.listo;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.buffer = '';
    this.esperando = null;
    this.proc.stdout.on('data', (d) => {
      this.buffer += d;
      const m = this.buffer.match(/<<FIN(OK|ERR)>>/);
      if (m && this.esperando) {
        const salida = this.buffer.slice(0, m.index).trim();
        this.buffer = this.buffer.slice(m.index + m[0].length);
        const { resolve, reject } = this.esperando;
        this.esperando = null;
        if (m[1] === 'OK') resolve(salida); else reject(new Error(salida.split('\n').pop() || 'error de PowerShell'));
      }
    });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => { this.proc = null; });
    this.listo = this.correrDirecto(INICIO);
    return this.listo;
  }

  // Manda un script como una sola línea (base64) y espera el marcador de fin
  correrDirecto(script) {
    return new Promise((resolve, reject) => {
      this.esperando = { resolve, reject };
      const b64 = Buffer.from(script, 'utf8').toString('base64');
      this.proc.stdin.write(`try { Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))); '<<FINOK>>' } catch { $_.Exception.Message; '<<FINERR>>' }\n`);
    });
  }

  correr(script) {
    if (!esWindows) return Promise.reject(new Error('el control de pantalla solo funciona en Windows'));
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cerrar(), MINUTOS_PARA_CERRAR * 60000);
    this.cola = this.cola.catch(() => {}).then(async () => {
      await this.iniciar();
      return this.correrDirecto(script);
    });
    return this.cola;
  }

  cerrar() { try { this.proc?.stdin.end(); this.proc?.kill(); } catch { /* nada */ } this.proc = null; }
}

const ps = new AyudantePS();
let ultimaLectura = { titulo: '', elementos: [] };

const PID = process.pid;
const enfocar = `[JV]::Objetivo(${PID}) | Out-Null; Start-Sleep -Milliseconds 120; `;

async function leerPantalla() {
  const json = await ps.correr(LEER.replace('__PID__', String(PID)));
  const datos = JSON.parse(json || '{}');
  const elementos = Array.isArray(datos.elementos) ? datos.elementos : (datos.elementos ? [datos.elementos] : []);
  ultimaLectura = { titulo: datos.titulo || '', elementos };
  return ultimaLectura;
}

function buscarElemento(ref) {
  const lista = ultimaLectura.elementos;
  const num = Number(ref);
  if (Number.isInteger(num) && num >= 1 && num <= lista.length) return lista[num - 1];
  const buscado = String(ref || '').toLowerCase().trim();
  if (!buscado) return null;
  return lista.find((e) => (e.n || '').toLowerCase() === buscado)
    || lista.find((e) => (e.n || '').toLowerCase().includes(buscado))
    || null;
}

// Nombre del elemento al que se refiere (número del listado o texto), para revisar si es sensible
async function nombreDe(elemento) {
  if (elemento === undefined || elemento === null || elemento === '') return '';
  let e = buscarElemento(elemento);
  if (!e) { await leerPantalla(); e = buscarElemento(elemento); }
  return e ? (e.n || '') : String(elemento);
}

async function clic({ elemento, x, y, boton = 'izquierdo', veces = 1 }) {
  let px = Number(x);
  let py = Number(y);
  let nombre = `(${px}, ${py})`;
  if (elemento !== undefined && elemento !== null && elemento !== '') {
    let e = buscarElemento(elemento);
    if (!e) { await leerPantalla(); e = buscarElemento(elemento); }
    if (!e) throw new Error(`no encontré "${elemento}" en la ventana activa`);
    px = e.x; py = e.y; nombre = `«${e.n || e.t}»`;
  }
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('faltan el elemento o las coordenadas');
  const b = boton === 'derecho' ? 'derecho' : 'izquierdo';
  const n = Math.min(3, Math.max(1, Number(veces) || 1));
  await ps.correr(`[JV]::Clic(${Math.round(px)}, ${Math.round(py)}, '${b}', ${n})`);
  return `Clic ${b === 'derecho' ? 'derecho ' : ''}${n > 1 ? `x${n} ` : ''}en ${nombre}`;
}

// "ctrl+s", "alt+tab", "enter", "win+d"… → SendKeys
function aSendKeys(combo) {
  const especiales = {
    enter: '{ENTER}', intro: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', espacio: ' ', space: ' ',
    borrar: '{BACKSPACE}', backspace: '{BACKSPACE}', suprimir: '{DELETE}', delete: '{DELETE}', supr: '{DELETE}',
    arriba: '{UP}', abajo: '{DOWN}', izquierda: '{LEFT}', derecha: '{RIGHT}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    inicio: '{HOME}', home: '{HOME}', fin: '{END}', end: '{END}', repag: '{PGUP}', avpag: '{PGDN}', pageup: '{PGUP}', pagedown: '{PGDN}',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  };
  const partes = String(combo || '').toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) throw new Error('falta la combinación de teclas');
  let mods = '';
  let tecla = '';
  for (const p of partes) {
    if (p === 'ctrl' || p === 'control') mods += '^';
    else if (p === 'alt') mods += '%';
    else if (p === 'shift' || p === 'mayus') mods += '+';
    else if (p === 'win' || p === 'windows') throw new Error('la tecla Windows no se puede enviar así; usá abrir_app o atajos con ctrl/alt');
    else tecla = especiales[p] || (p.length === 1 ? p.replace(/[+^%~(){}[\]]/g, '{$&}') : null);
    if (tecla === null) throw new Error(`no conozco la tecla "${p}"`);
  }
  return mods + tecla;
}

async function teclas({ combinacion, veces = 1 }) {
  const sk = aSendKeys(combinacion).replace(/'/g, "''");
  const n = Math.min(20, Math.max(1, Number(veces) || 1));
  await ps.correr(`${enfocar}1..${n} | % { [System.Windows.Forms.SendKeys]::SendWait('${sk}'); Start-Sleep -Milliseconds 40 }`);
  return `Presioné ${combinacion}${n > 1 ? ` x${n}` : ''}`;
}

async function desplazar({ direccion = 'abajo', cantidad = 3 }) {
  const n = Math.min(30, Math.max(1, Number(cantidad) || 3));
  const delta = (direccion === 'arriba' ? 1 : -1) * 120 * n;
  await ps.correr(`[JV]::Rueda(${delta})`);
  return `Desplacé ${direccion} (${n})`;
}

async function escribir({ texto }) {
  const sk = String(texto ?? '').replace(/[+^%~(){}[\]]/g, '{$&}').replace(/\r?\n/g, '{ENTER}').replace(/'/g, "''");
  await ps.correr(`${enfocar}[System.Windows.Forms.SendKeys]::SendWait('${sk}')`);
  return 'Texto escrito';
}

async function tituloObjetivo() {
  return ps.correr(`[JV]::Objetivo(${PID}) | Out-Null; [JV]::Titulo()`);
}

module.exports = { leerPantalla, clic, teclas, desplazar, escribir, nombreDe, tituloObjetivo, cerrar: () => ps.cerrar() };
