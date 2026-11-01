// Puente seguro entre la interfaz y el proceso principal
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: () => ipcRenderer.invoke('config:leer'),
  prompt: (opciones) => ipcRenderer.invoke('sistema:prompt', opciones),
  acciones: () => ipcRenderer.invoke('acciones:listar'),
  ejecutar: (tipo, args, autorizacion) => ipcRenderer.invoke('accion:ejecutar', { tipo, args, autorizacion }),
  nuevoTurno: (opciones) => ipcRenderer.invoke('seguridad:turno', opciones),
  evaluar: (tipo, args) => ipcRenderer.invoke('seguridad:evaluar', { tipo, args }),
  permisos: () => ipcRenderer.invoke('seguridad:permisos'),
  revocarPermisos: () => ipcRenderer.invoke('seguridad:revocar'),

  chat: (id, messages, conHerramientas) => ipcRenderer.invoke('llm:chat', { id, messages, conHerramientas }),
  cancelar: (id) => ipcRenderer.invoke('llm:cancelar', id),
  onChunk: (cb) => ipcRenderer.on('llm:chunk', (_e, d) => cb(d)),

  onDecir: (cb) => ipcRenderer.on('jarvis:decir', (_e, d) => cb(d)),
  onEnfocar: (cb) => ipcRenderer.on('jarvis:enfocar', () => cb()),
  onEscuchar: (cb) => ipcRenderer.on('jarvis:escuchar', () => cb()),
  onAviso: (cb) => ipcRenderer.on('jarvis:aviso', (_e, msg) => cb(msg)),
  onDetenerControl: (cb) => ipcRenderer.on('jarvis:detener-control', () => cb()),
  transcribir: (audio) => ipcRenderer.invoke('voz:transcribir', audio),
  sintetizar: (texto) => ipcRenderer.invoke('tts:sintetizar', texto),

  telemetria: () => ipcRenderer.invoke('sistema:telemetria'),

  historial: () => ipcRenderer.invoke('historial:cargar'),
  guardarHistorial: (h) => ipcRenderer.invoke('historial:guardar', h),

  modo: (m) => ipcRenderer.invoke('ventana:modo', m),
  ocultar: () => ipcRenderer.invoke('ventana:ocultar'),
  recargar: () => ipcRenderer.invoke('ventana:recargar'),
  abrirCarpeta: () => ipcRenderer.invoke('carpeta:abrir'),
});
