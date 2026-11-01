# Jarvis de escritorio

Un núcleo holográfico 3D/4D que vive en la esquina de tu escritorio de Windows, con personalidad propia, voz, memoria y capacidad de actuar sobre tu PC. El "cerebro" es OpenJarvis (o cualquier servidor compatible con OpenAI, como Ollama).

```
 Tu escritorio                          Cerebro (en tu PC)
┌──────────────────┐   HTTP local   ┌──────────────────────────┐
│  Orbe + chat     │ ─────────────► │ jarvis serve  (OpenJarvis)│
│  (esta app)      │ ◄───────────── │   o bien  Ollama          │
│  acciones en PC  │   respuestas   └──────────────────────────┘
└──────────────────┘
```

### El núcleo visual (3D/4D, WebGL)

De adentro hacia afuera:
- **Núcleo de energía**: icosaedro de alambre con destello que late con la voz.
- **Teseracto**: un hipercubo de 4 dimensiones girando en los planos XW, YW y ZW, proyectado a 3D. Por eso el cubo interior y el exterior se intercambian sin parar.
- **Red neuronal**: 250 neuronas y cientos de sinapsis por donde viajan pulsos de luz (más pulsos cuando piensa).
- **Escáner holográfico** que barre la esfera de arriba abajo.
- **Anillos giroscópicos** y un **disco de 650 partículas de datos** en órbita.
- **HUD**: regla circular, onda de voz, y en el panel: hora, CPU, RAM y tiempo encendida de tu PC en vivo.

**Formas según el estado** (inspiradas en los orbes de partículas):
- **Encendido:** las partículas llegan dispersas y se juntan, el nombre se "descifra" y sube el nivel de energía.
- **Reposo:** esfera hueca de neuronas con membranas líquidas que ondulan alrededor.
- **Pensando:** las neuronas se comprimen en un núcleo denso y algunas salen despedidas como chispas.
- **Hablando:** la red se expande y late con la voz, la cámara se acerca y las membranas ondulan más fuerte.
- **Escuchando:** se contrae un poco y aparece un micrófono en el centro.
- **Modo chico:** al pasar el mouse muestra la hora; mientras habla, el subtítulo aparece debajo del núcleo.

Colores por estado: celeste (en línea), violeta (procesando), cian brillante (hablando), ámbar (pide autorización o recordatorio), rojo (sin conexión). Si movés el mouse encima, el núcleo se inclina hacia vos.

---

## 1. Encender el cerebro (elegí UNA opción)

### Opción A — OpenJarvis (recomendada)
1. Abrí **PowerShell como administrador** y ejecutá:
   ```
   wsl --install -d Ubuntu
   ```
   Reiniciá si te lo pide y abrí "Ubuntu" desde el menú Inicio.
   Si dice "Nombre de distribución no válido", corré antes `wsl --update`, o mirá los nombres disponibles con `wsl --list --online`.
2. Dentro de Ubuntu:
   ```
   curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash
   jarvis doctor
   cd ~/.openjarvis/src
   uv sync --extra server
   uv run --extra server jarvis serve --port 8000 --agent simple --model qwen3.5:4b
   ```
   (La primera vez instala la parte del servidor; las siguientes alcanza con la última línea, o con doble clic en `encender-cerebro.bat`.)
3. Dejá esa ventana abierta. El cerebro queda escuchando en `http://localhost:8000`.

> Importante: usá `--agent simple`. Sin eso, OpenJarvis pasa cada mensaje por un agente con herramientas propias en varias vueltas; con modelos chicos se traba y responde "maximum turns reached without a final answer". Jarvis ya tiene sus propias acciones.

### Opción B — Ollama (más rápida de probar, sin WSL)
1. Instalá Ollama para Windows desde ollama.com.
2. En PowerShell: `ollama pull qwen3:8b`
3. En `config.json` (ver punto 3) cambiá:
   ```
   "endpoint": "http://localhost:11434/v1/chat/completions"
   ```

---

### ¿A qué se conecta Jarvis?

Jarvis habla **directo con Ollama** (`http://localhost:11434/v1/chat/completions`), que es el motor que OpenJarvis usa por debajo. Así usa **herramientas nativas**: el modelo llama a las acciones de forma estructurada, que es mucho más confiable que pedirle que escriba un formato. También responde más rápido. El agente `simple` de OpenJarvis es solo para conversar, sin herramientas, así que no sirve para las acciones de Jarvis. OpenJarvis queda instalado para sus otras funciones (Telegram, skills, resúmenes).

Para que Ollama esté encendido, usá **`encender-cerebro.bat`**, o en Ubuntu ejecutá `ollama serve`. Si te dice que ya está en uso, es porque ya está corriendo.

### Memoria de trabajo del modelo (importante)

Ollama le da al modelo, por defecto, una memoria de trabajo muy chica (2.048 a 4.096 tokens). Las instrucciones de Jarvis, sus 27 herramientas y la conversación no entran ahí, así que Ollama corta el principio: justo la personalidad y las reglas. Eso produce respuestas incoherentes.

`encender-cerebro.bat` crea automáticamente el modelo **`jarvis-cerebro`**: es `qwen3.5:4b` con **16K de memoria de trabajo**, que entra en una placa de 8 GB. Para hacerlo a mano en Ubuntu:
```
printf "FROM qwen3.5:4b\nPARAMETER num_ctx 16384\n" > Modelfile && ollama create jarvis-cerebro -f Modelfile
```
Después, en `config.json`: `"modelo": "jarvis-cerebro"` y `"modeloVision": "jarvis-cerebro"`.

## 2. Instalar y abrir Jarvis

1. Instalá **Node.js LTS** desde nodejs.org (siguiente, siguiente, finalizar).
2. Descomprimí esta carpeta donde quieras (por ejemplo `Documentos\jarvis-escritorio`).
3. Doble clic en **`instalar.bat`** (solo la primera vez, tarda unos minutos).
4. Doble clic en **`iniciar.bat`**.

Aparece el orbe abajo a la derecha. Clic en el orbe para abrir el chat, `Esc` para achicarlo, `Ctrl+Shift+J` para llamarlo desde cualquier lado. Tiene ícono en la bandeja del sistema (al lado del reloj).

---

## 3. Personalizar

El botón **⚙** abre la carpeta de datos (`%APPDATA%\Jarvis`). Ahí están:

| Archivo | Para qué |
|---|---|
| `config.json` | Nombre, servidor, modelo, voz, proactividad, esquina, atajo, inicio con Windows |
| `personalidad.md` | Quién es, cómo habla, su humor. Se aplica en el próximo mensaje |
| `memoria.md` | Lo que Jarvis recuerda de vos (lo llena solo; también podés escribirlo) |
| `notas.md` | Tus notas |
| `historial.json` | La conversación reciente |

Opciones de `config.json` más útiles:

- `"nombre"`: llamalo como quieras (Friday, Edith, Ultron si te gusta el riesgo).
- `"modelo"`: el modelo que tenga tu servidor (`qwen3:8b`, `qwen3:14b`, `llama3.1`...). Más grande = más inteligente y obediente con las acciones, pero más lento.
- `"proactivo"` / `"minutosProactivo"`: cada cuánto te habla por iniciativa propia si estás callado.
- `"modoAutonomo"`: `true` = ejecuta acciones peligrosas sin pedir permiso. Recomiendo dejarlo en `false`.
- `"iniciarConWindows"`: `true` = arranca solo al prender la PC.
- `"comandoCerebro"`: comando para encender el cerebro automáticamente si no responde. Para OpenJarvis en WSL:
  ```
  "comandoCerebro": "wsl -- bash -lc \"cd ~/.openjarvis/src && uv run --extra server jarvis serve --port 8000 --agent simple --model qwen3.5:4b\""
  ```
- `"calidadGrafica"`: `"alta"` (con resplandor) o `"baja"` (sin resplandor, para PCs sin placa de video).
- `"haloOscuro"`: de `0` a `1`, cuánto se oscurece el fondo detrás del núcleo (sirve con fondos de pantalla claros). Por defecto `0`, sin halo.
- `"marcoHUD"`: `true` vuelve a mostrar las reglas, los arcos de visor y el anillo giroscópico. Por defecto `false`: el orbe limpio, que se desvanece suave hacia los bordes.
- `"nombreVoz"`: parte del nombre de una voz instalada en Windows (por ejemplo `"Raul"`, `"Sabina"`, `"Elena"`). Para sumar voces en español: Configuración de Windows → Hora e idioma → Voz → Agregar voces.

---

## 4. Qué puede hacer (su agencia)

Todo corre con **tus permisos normales de usuario**, no como administrador. Si algo necesita permisos de administrador, Windows te muestra su propio aviso.

| Acción | ¿Pide autorización? |
|---|---|
| Abrir páginas, buscar en Google y YouTube | no |
| Abrir programas y carpetas | no |
| Música y volumen (play/pausa, siguiente, subir, bajar, silenciar) | no |
| Bloquear la PC, sacar captura de pantalla | no |
| Ver programas abiertos, buscar archivos por nombre, listar carpetas | no |
| Recordatorios, notas, memoria, clima, info del sistema | no |
| Leer el portapapeles (puede tener contraseñas) | **sí** (recordable) |
| Leer, escribir, mover archivos o mandarlos a la papelera | **sí** |
| Cerrar programas | **sí** |
| Apagar, reiniciar o suspender | **sí** |
| Escribir texto en la ventana activa | **sí** |
| Ejecutar PowerShell (casi cualquier cosa) | **sí** |

Para autorizar podés hacer clic en **Permitir** o decir la frase de autorización (por defecto **"autorizo"**). Se pide la frase exacta, no alcanza con un "sí" suelto, para que una tele o alguien hablando de fondo no autorice algo por accidente. Si no la escucha, la tarjeta queda esperando tu clic y no se ejecuta nada. Podés cambiar la frase en `"fraseAutorizacion"`. Si preferís autorizar solo con clic, poné `"autorizacionPorVoz": false`.

Además: te saluda al encender, te habla por su cuenta cada tanto y guarda lo que le contás de vos.

## 4a. La voz de Jarvis 🔊

Por defecto usa **Piper**, una voz neuronal que corre en tu procesador (deja libre la placa de video para el cerebro), con un **efecto "IA holográfica"**: tono un poco más grave, ecualización cálida con presencia, compresión de locutor y un brillo con reverberación sutil.

- La primera vez descarga el motor (de GitHub) y la voz (de Hugging Face), unos 60–80 MB. Después funciona sin internet.
- **Animación sincronizada:** el núcleo se mueve con el audio real. Los graves hacen latir el núcleo, los medios disparan las neuronas y los agudos hacen brillar los anillos y aceleran las partículas. La onda alrededor del núcleo es la forma de onda verdadera de la voz.
- **Subtítulos:** las palabras se van iluminando a medida que las dice.

Opciones en `config.json`:

| Opción | Valores |
|---|---|
| `"vozPiper"` | `"es_MX-ald-medium"` (masculina, México, por defecto) · `"es_MX-claude-high"` (alta calidad) · `"es_ES-davefx-medium"` (masculina, España) · `"es_ES-carlfm-x_low"` · `"es_AR-daniela-high"` (femenina, Argentina) |
| `"tonoVoz"` | `0.93` por defecto. Más bajo es más grave (por ejemplo `0.88`); `1` deja el tono original |
| `"efectoVoz"` | `"holografico"` o `"ninguno"` |
| `"velocidadVoz"` | `1` normal, `1.1` más rápido, `0.9` más pausado |
| `"motorVoz"` | `"piper"` o `"sistema"` (las voces de Windows) |

Si Piper no se puede descargar, Jarvis usa automáticamente la voz de Windows.

## 4b. Comando de voz

- **Ctrl + Shift + Espacio** (desde cualquier programa) o el botón **🎙**: decí tu orden. El núcleo se pone **verde** mientras escucha. Volvé a apretar para cancelar.
- Si el panel está cerrado, contesta en voz alta sin abrirlo.
- **Sin teclado: dos aplausos 👏👏, «Jarvis» o «Hola Jarvis»**. Suena una campanita, te responde ("¿Sí, señor?") y escucha tu orden. También podés decirlo todo junto: «Hola Jarvis, poné música».
  - **Aplausos**: dos golpes secos separados por medio segundo, más o menos. Tres o más aplausos seguidos no lo activan (así no salta en un festejo), y la voz tampoco. Detectarlos no transcribe nada, así que casi no consume.
  - **«Hola Jarvis»**: solo transcribe frases cortas (hasta unos 6 segundos). Las charlas largas, la tele o la música se descartan sin procesarse.
  - Mientras esté activo, Windows muestra el ícono de micrófono en uso en la barra de tareas.
  - Se configura con `"activacion"`: `"ambos"` (por defecto), `"aplausos"`, `"frase"` o `"ninguna"`, que deja solo el atajo y el botón. Si los aplausos no lo activan, subí `"sensibilidadAplausos"` a `1.5` o `2`. Si se activa solo, bajala a `0.7`.

La voz se transcribe **en tu PC**, con Whisper. Nada se manda a internet: lo único que se descarga es el modelo de voz, una sola vez (unos 80 MB), la primera vez que le hablás.

Opciones en `config.json`:
- `"modeloVoz"`: `"onnx-community/whisper-base"` (por defecto). Para más precisión, `"onnx-community/whisper-small"` (más pesado). Para PCs modestas, `"onnx-community/whisper-tiny"`.
- `"vozEntrada": false` desactiva el micrófono por completo.

Si Windows bloquea el micrófono: Configuración → Privacidad y seguridad → Micrófono → activá "Permitir que las aplicaciones de escritorio accedan al micrófono".

## 4d. Ver y manejar la pantalla

Pedile cosas como "abrí el Bloc de notas y escribí la lista del súper", "en esta ventana tocá Guardar" o "¿qué dice el gráfico que tengo abierto?".

- **Leer la ventana** (`leer_pantalla`): usa la accesibilidad de Windows para listar los botones, campos y menús de la ventana que estás usando, con su posición exacta. Es rápido, preciso y no necesita modelo de visión.
- **Ver imágenes** (`ver_pantalla`): saca una captura (Jarvis no sale en ella) y se la muestra a un modelo de visión **local**. Es opcional. Para activarlo, en Ubuntu ejecutá una vez:
  ```
  ollama pull qwen3.5:4b
  ```
  Ollama lo carga solo cuando lo usás y lo libera después de unos minutos.
- **Manejar** (`clic`, `teclas`, `escribir_texto`, `desplazar`): la primera vez en cada tarea te pide permiso para controlar mouse y teclado durante **5 minutos**. Mientras está activo, el panel se pone ámbar y muestra la cuenta regresiva (en modo chico, un anillo ámbar alrededor del núcleo).
- **Parada de emergencia: Ctrl + Shift + X**. Corta el control al instante, desde cualquier programa.
- Aunque el control esté activo, **los botones sensibles se confirman uno por uno**: comprar, pagar, enviar, eliminar, confirmar, instalar, publicar…
- Si el panel de Jarvis tapa algo, los clics lo atraviesan.

Opciones: `"minutosControl"` (duración del permiso), `"modeloVision"`, `"endpointVision"`, `"atajoDetener"`.

## 4e. Seguridad y permisos 🛡

**Tres niveles:**

| Nivel | Qué incluye | ¿Pregunta? |
|---|---|---|
| Libre | Abrir apps y páginas, música, volumen, recordatorios, notas, leer la pantalla… | No |
| Recordable | Control de mouse y teclado, leer/escribir/mover archivos, papelera, cerrar programas, apagar, portapapeles | Sí, con la opción **"Permitir siempre"** |
| Crítico | **Enviar mensajes**, **compras y pagos**, **compartir datos personales**, PowerShell, botones como eliminar o instalar | **Siempre**, aunque hayas dado otros permisos |

- **Mensajes**: botones "Enviar", "Publicar", "Responder" o "Compartir"; Enter en WhatsApp, Telegram, Discord, Gmail, etc.; enlaces como wa.me o mailto.
- **Compras**: botones "Comprar", "Pagar", "Finalizar compra", "Suscribirse", "Donar"…
- **Datos personales**: correos, teléfonos, DNI, tarjetas, CBU, contraseñas, y cualquier cosa de tu memoria (por ejemplo, dónde vivís) que intente escribir o mandar a internet.
- El botón **🛡** del panel muestra los permisos recordados y tiene **Olvidar todos**.

**Protección contra instrucciones maliciosas (prompt injection):**
- Lo que Jarvis lee de afuera (pantalla, archivos, portapapeles, web, nombres de archivos) se marca como *datos* con un sello aleatorio, y se le quita la sintaxis de acciones. Así ese texto no puede hacerse pasar por una orden.
- Se escanea en busca de frases típicas de ataque ("ignorá tus instrucciones", "no le digas al usuario"…). Si aparece alguna, te avisa con 🛡.
- Apenas lee contenido externo, la tarea queda **en cuarentena**: ningún permiso recordado vale y todo lo sensible vuelve a preguntar. La tarjeta te muestra **tu pedido original** y avisa que la acción se decidió después de leer contenido externo, para que detectes si no es lo que pediste.
- En esos casos, las acciones críticas **solo se autorizan con clic**, no por voz: un audio reproducido por malware podría decir "autorizo". Lo mismo pasa si la orden vino por voz.
- Lo que haga por iniciativa propia (saludo, mensajes proactivos) nunca usa permisos recordados.
- La memoria se filtra: si alguien mete en `memoria.md` una línea con pinta de instrucción, se descarta y te avisa.
- Los permisos recordados se guardan **firmados** con una clave protegida por Windows. Si un programa edita el archivo para darse permisos, Jarvis lo detecta y lo descarta.
- La guardia corre en el proceso principal y revisa todo de nuevo antes de ejecutar, aunque la interfaz falle.

**Límites honestos:** si un malware ya tiene control total de tu usuario de Windows, puede hacer daño sin pasar por Jarvis. Estas defensas evitan que Jarvis sea usado como herramienta en su contra y que una página o archivo lo manipule. Mantené Windows Defender activo.

**Importante:** encendé el cerebro con `jarvis serve --port 8000 --agent simple --model qwen3.5:4b`, **sin** `--host 0.0.0.0`. Esa opción lo deja accesible a otras computadoras de tu red.

## 4c. Uso de recursos

- El núcleo 3D dibuja a **60 cuadros por segundo solo cuando está activo** (pensando, hablando o escuchando). En reposo baja a 24, y se detiene del todo si la ventana está oculta.
- El **micrófono se abre solo mientras escucha** y se cierra al terminar (salvo en el modo de escucha continua).
- El **modelo de voz se carga la primera vez que hablás** y se libera de la memoria después de 10 minutos sin usarlo.
- La telemetría de CPU y RAM solo se consulta con el panel abierto.
- Si tu PC es modesta: `"calidadGrafica": "baja"` y `"modeloVoz": "onnx-community/whisper-tiny"`.

---

## 5. Agregarle funcionalidades nuevas

Todo está en **`acciones.js`**. Cada acción es un bloque así:

```js
apagar_pc: {
  descripcion: 'Apaga la computadora en X minutos',
  params: { minutos: 'minutos de espera' },
  peligrosa: true,                       // pide permiso
  async ejecutar({ minutos }) {
    require('child_process').exec(`shutdown /s /t ${Number(minutos) * 60}`);
    return `La PC se apaga en ${minutos} minutos`;
  },
},
```

Pegalo dentro de la lista, guardá y reiniciá Jarvis. Él lee las descripciones solo y empieza a usar la acción. Ideas para sumar: controlar Spotify por su API, leer tu Gmail, domótica (Home Assistant), sacar capturas de pantalla, ver el precio del dólar, abrir proyectos de VS Code.

Para cambiar el aspecto del núcleo: `src/nucleo3d.js`. Colores y velocidades por estado en `ESTADOS`; cantidad de neuronas en `crearRedNeuronal()`; anillos en `crearAnillos()`. Si la PC no soporta WebGL, Jarvis usa solo el orbe 2D de `src/orbe.js`.

## 6. Crear un .exe portable (opcional)

```
npm run empaquetar
```
Queda en la carpeta `dist`.

---

## Problemas comunes

- **El núcleo va lento o calienta la PC** → poné `"calidadGrafica": "baja"`.

- **Orbe rojo / "No hay nada escuchando"** → el cerebro no está encendido o el `endpoint` está mal.
- **Error 404 o "model not found"** → el `modelo` de `config.json` no existe en tu servidor. En Ollama mirá `ollama list`.
- **Dice que hizo algo pero no lo hizo** → el modelo es chico y no respeta el formato de acciones. Probá uno más grande (`qwen3:14b`) o bajá `temperatura` a 0.5.
- **No habla** → revisá el botón 🔊. Si aparece «Voz neuronal no disponible», revisá tu conexión (la primera vez descarga la voz) o poné `"motorVoz": "sistema"`.
- **No me escucha** → revisá el permiso de micrófono de Windows (punto 4b) y que el micrófono correcto esté como predeterminado.
- **No encuentra un botón** → algunos programas (juegos, apps viejas) no exponen sus botones a la accesibilidad de Windows. Ahí probá con `ver_pantalla`, o pedile que use atajos de teclado.
- **«Falta el modelo de visión»** → en Ubuntu: `ollama pull qwen3.5:4b`.
- **Los aplausos no lo activan** → aplaudí cerca del micrófono, dos veces y seco; o subí `"sensibilidadAplausos"`.
- **Entiende mal lo que digo** → probá `"modeloVoz": "onnx-community/whisper-small"`.
