# spotifymarketbot

Bot de Discord de Spotify Market: soporte por tickets, moderación, registros,
catálogo, bienvenida, estado del servicio y sugerencias.

Construido sobre **discord.js 14.27** usando **Components V2** en exclusiva. No
se usan embeds, ni `content` plano, ni accent colors: toda la interfaz sale de
`ContainerBuilder` y la jerarquia visual se construye con markdown y emojis.

## Requisitos

- Node.js 22 o superior
- Una aplicacion creada en el [portal de desarrolladores](https://discord.com/developers/applications)

## Puesta en marcha

```bash
npm install
cp .env.example .env    # rellena DISCORD_TOKEN, CLIENT_ID y GUILD_ID
npm start
```

En el portal de desarrolladores, dentro de **Bot > Privileged Gateway Intents**,
activa los intents que declares en `config/bot.json`. Con la configuracion por
defecto hacen falta **Server Members Intent** y **Message Content Intent**: el
primero para los logs de entrada y salida, el segundo para poder registrar el
contenido de un mensaje borrado. Si no los activas, el arranque falla con un
mensaje explicito en consola.

El bot necesita ademas **Ver registro de auditoria** para poder decir quien
borro un canal o baneo a alguien, y **Gestionar canales** para crear los de los
tickets.

Para desarrollo con recarga en caliente:

```bash
npm run dev
```

## Estructura

```
index.js          Bootstrap: entorno, carga de comandos y eventos, login.
config/           Toda la configuracion editable. Ningun ID ni texto en el codigo.
commands/         Un archivo por comando, agrupado por dominio.
events/           Un archivo por evento de Discord.
modules/          Sistemas con estado propio, una clase cada uno.
database/         JSON por dominio, escritura atomica. Generado en ejecucion.
emojis/           Los .png. Fuente de verdad de los emojis.
utils/            Piezas sin estado y reutilizables.
```

Reparto de responsabilidades: un comando valida la entrada y delega, un modulo
tiene la logica y el estado, un util es sin estado. Si un comando pasa de ~150
lineas, su logica se mueve a un modulo.

## Emojis

La carpeta `emojis/` es la unica fuente de verdad. Al arrancar, el bot sube cada
imagen a los Application Emojis de la aplicacion y cachea los IDs en
`emojis.json`. En el codigo solo se referencian por nombre:

```js
emojis.get('success')
```

Nunca se escribe un emoji Unicode ni un ID literal. Una clave sin archivo
devuelve cadena vacia y avisa una vez por consola, para que el panel se vea
limpio y el fallo sea evidente en los logs. Los botones aplican el icono solo si
existe, asi que un `.png` que falte nunca tumba un mensaje.

### Roles

`config/emojis.json` mapea roles semanticos a nombres de archivo:

```json
{ "roles": { "info": "notificacion" } }
```

En el codigo se pide el rol, no el archivo:

```js
emojis.rol('info')     // resuelve a notificacion.png
emojis.get('ticket')   // tambien vale el nombre de archivo directo
```

Asi se cambia el icono de un concepto en un solo sitio, sin tocar codigo. Una
clave sin rol declarado se busca tal cual como nombre de archivo.

Al anadir nuevos `.png` sin reiniciar, resincroniza con `/emojis`.

## Configuracion

| Archivo | Contenido |
|---|---|
| `config/bot.json` | Intents de la gateway y presencia del bot |
| `config/brand.json` | Nombre, recursos visuales originales y enlaces oficiales |
| `config/emojis.json` | Mapa de roles semanticos a nombres de archivo de `emojis/` |
| `config/permissions.json` | Roles de staff, su nivel y el nivel que pide cada accion |
| `config/tickets.json` | Panel, categorias, formularios, prioridades y ajustes |
| `config/verify.json` | Canal, rol y textos del panel de verificacion |
| `config/welcome.json` | Bienvenidas, tarjeta dinamica, despedidas, roles e hitos |
| `config/rules.json` | Panel navegable y categorias editables de normas |
| `config/logs.json` | Canal por categoria, filtros y agrupacion |
| `config/moderacion.json` | Aviso por MD y escalado por acumulacion de avisos |
| `config/shop.json` | Moneda, categorias, textos del catalogo y categoria de ticket para la compra |
| `config/status.json` | Estados operativos, banner, nota e historial del servicio |
| `config/suggestions.json` | Panel, canal, votos y estados de las sugerencias |

Los IDs y textos existentes se conservan como fuente de verdad. Los destinos
opcionales pueden quedarse vacíos hasta activarlos con `/setup`; `/diagnostics`
comprueba IDs, permisos, recursos y límites antes de que un fallo llegue a un
usuario. Cada guardado crea una copia automática en `config/backups/` y la API
rechaza configuraciones que Discord no podría publicar.

`presencia.actividad.nombre` vacio deja al bot sin actividad, sin inventar
ningun texto. Los tipos validos son `Playing`, `Streaming`, `Listening`,
`Watching`, `Competing` y `Custom`.

## Sistemas

**Tickets.** Panel publico de marca con select de categoria, formulario por categoria
definido en config, canal privado con permisos por rol, claim, cierre en dos
pasos con motivo, transcripcion HTML para el canal de logs y el usuario,
valoracion por MD de 1 a 5,
anti-mencion al staff con esperas escaladas y autocierre por inactividad. Al
arrancar limpia los tickets cuyo canal ya no existe. La vista pública solo
muestra **Claim**, **Admin menu** y **Close**. El menú privado del staff reúne
prioridad, participantes, renombrado, notas internas, bloqueo, refresco y
notificación por MD con botón directo al ticket. No existen subcomandos
`/ticket` duplicados. Al cerrar, el canal se bloquea y archiva; el staff
autorizado puede reabrirlo o eliminarlo con confirmacion. La apertura está
protegida frente a dobles clics concurrentes y la numeración nunca se reutiliza.

**Bienvenidas.** Mensaje V2 sin accent color con datos del miembro y una tarjeta
PNG generada al vuelo. El avatar real aparece nitido en primer plano y ampliado
como fondo desenfocado. Incluye despedidas, aviso de cuentas nuevas, botones de
acceso, roles automaticos, mensaje privado e hitos configurables. Usa
`/publish panel:welcome-preview` para publicar una vista previa antes de activar el canal.
La tarjeta usa Montserrat Variable autoalojada en `assets/fuentes/`.

**Normas.** Panel publico con banner original de la tienda, resumen de
categorias y selector. Cada categoria abre en privado sus secciones numeradas;
todo el contenido se edita desde `config/rules.json` o desde el dashboard.

**Verificacion.** Panel con boton que entrega un rol y deja constancia de quien
y cuando. El panel muestra el número de verificados, se actualiza tras cada alta
y queda bloqueado automáticamente si el sistema o el rol no están disponibles.

**Moderacion.** `ban`, `unban`, `kick`, `timeout`, `untimeout`, `warn`,
`warnings`, `remove-warning` y `clear`. La jerarquia se valida en ambos sentidos, se
notifica por MD antes de ejecutar, y los avisos escalan a sanciones automaticas
segun `config/moderacion.json`. Un aviso retirado se desactiva, nunca se borra.
El historial de avisos tiene paginación real y `/channel` permite bloquear,
desbloquear, aplicar modo lento y revisar la configuración de un canal.

**Catalogo.** Productos que se gestionan desde una única entrada `/product`,
con autocompletado de acción, categoría y producto. El alta y la edición usan
modal. El panel publico
resume las categorias y abre el catalogo **en efimero para cada usuario**: si la
paginacion viviera en el mensaje publico, un usuario pasando de pagina se la
cambiaria a todos los demas.

El bot no cobra ni procesa pagos ni entrega credenciales. Al pulsar Comprar
comprueba la disponibilidad y abre un ticket de la categoria configurada en
`shop.compra.categoriaTicket`, con el producto ya rellenado en el formulario.
El trato se cierra ahi, con una persona delante.

El stock admite `bajo pedido` para lo que no tiene limite. La descripcion se
limpia de HTML al guardar, no al pintar: Discord no interpreta HTML y un
`<p class="...">` pegado desde una web se veria tal cual en el panel.

**Logs.** Un canal por categoria con respaldo a `todos`. Registra mensajes,
adjuntos, miembros, moderacion, canales, hilos, roles y diferencias de permisos,
voz, emojis, stickers, eventos programados, cambios del servidor y cada acción
interna de tickets. Cuando Discord ofrece evidencia, consulta auditoría y
conserva ejecutor, motivo, IDs, estado anterior/nuevo y tiempos. Los eventos se
agrupan en lotes para no comerse el rate limit.

**Estado.** Panel público con banner original de la tienda, disponibilidad,
nota operativa e historial. El equipo autorizado cambia el estado o la nota
desde el propio mensaje y todos los paneles publicados se actualizan en sitio.

**Sugerencias.** Panel y comando `/suggest` con formulario, votos únicos por
usuario, cambio de voto, hilo opcional, estados configurables y respuesta
pública del equipo. La resolución puede notificarse al autor por mensaje
privado.

Sin accent color, el indicador visual rapido de cada log es su emoji de
cabecera: uno distinto por tipo de accion, siempre el mismo para la misma.

## Comandos

| Comando | Permiso | Descripcion |
|---|---|---|
| `/publish` | Administrador | Publica cualquier panel mediante autocompletado y canal |
| `/product` | Administrador | Gestiona todas las acciones del catálogo desde una entrada |
| `/emojis` | Administrador | Resincroniza los emojis desde la carpeta `emojis/` |
| `/ban` | Banear miembros | Banea a un usuario |
| `/unban` | Banear miembros | Retira un baneo por ID |
| `/kick` | Expulsar miembros | Expulsa a un usuario |
| `/timeout` | Moderar miembros | Silencia temporalmente (maximo 28 dias) |
| `/untimeout` | Moderar miembros | Retira el silencio |
| `/warn` | Moderar miembros | Registra un aviso y aplica el escalado |
| `/warnings` | Moderar miembros | Muestra el historial de avisos |
| `/remove-warning` | Moderar miembros | Retira un aviso del historial |
| `/clear` | Gestionar mensajes | Borra mensajes recientes del canal |
| `/channel` | Gestionar canales | Bloquea, desbloquea, aplica modo lento o inspecciona un canal |
| `/say` | Gestionar mensajes | Editor V2 avanzado con multimedia, archivos, audiencias, diseños, botones y vista previa |
| `/setup` | Administrador | Configura canales, roles y categorias sin copiar IDs a mano |
| `/diagnostics` | Administrador | Revisa configuración, IDs y permisos reales del bot |
| `/ticket-stats` | Gestionar canales | Analiza backlog, flujo, SLA, valoraciones y carga del equipo |
| `/help` | Todos | Muestra los comandos disponibles |
| `/status` | Todos | Consulta la disponibilidad actual del servicio |
| `/suggest` | Todos | Envía una propuesta a la comunidad |
| `/server-info` | Todos | Muestra la ficha técnica completa del servidor |
| `/user-info` | Todos | Muestra cuenta, membresía, roles y permisos de un miembro |

## Dashboard

`dashboard/` es una app Next.js aparte con vistas operativas de tickets y
moderacion, catalogo, anuncios, paneles y configuracion. El dashboard
habla con el bot por la API local de `modules/apiServer.js` — nunca toca
`config/*.json` directamente. Requiere `DASHBOARD_TOKEN` en el `.env` del
bot (ver arriba) y su propio `.env.local` (ver `dashboard/README.md`).

```bash
cd dashboard
npm install
cp .env.local.example .env.local
npm run dev
```

## Estado del proyecto

- [x] **Fase 1 — Base.** Estructura, arranque, carga de comandos y eventos,
      gestor de emojis con roles configurables, base de datos JSON atomica,
      helpers de Components V2 sin accent color, consola minimalista y apagado
      limpio.
- [x] **Fase 2 — Nucleo de Discord.** Verificacion, sistema de tickets por
      categorias con formularios, claim, transcripciones y valoraciones,
      moderacion con escalado y logs por categoria.
- [x] **Fase 3 — Catalogo.** Productos gestionados desde el bot, stock,
      paginacion efimera por usuario y compra atendida por ticket.
- [x] **Fase 4 — Dashboard.** Panel web para editar toda la configuracion y
      redactar anuncios en Components V2. Ver `dashboard/README.md`.
- [x] **Fase 5 — Operaciones.** Bienvenida dinámica, normas, diagnóstico,
      configuración segura con backups, estado del servicio, sugerencias,
      herramientas avanzadas de tickets y paneles web ampliados.

## Verificación local

```bash
npm test
cd dashboard
npm run lint
npx tsc --noEmit
npm run build
```

La comprobación del bot valida sintaxis, los 13 esquemas de configuración,
emojis, comandos duplicados y la ausencia de accent color en Components V2.

## Consola

Sin cajas, sin reglas ni banners: solo sangria, una columna de simbolo, una de
ambito y el mensaje.

El arranque no lleva marca de hora — es una secuencia y se lee de un vistazo.
Todo lo que ocurre despues si la lleva, porque ahi el cuando importa. Los avisos
que caen durante el arranque tampoco la llevan, para que las columnas no queden
dentadas.

```
  spotifymarketbot  0.1.0
  discord.js 14.27.0 · node v22.22.2

  ✓ comandos     1 cargados
  ✓ eventos      2 registrados
  ✓ sesion       ...
  ✓ emojis       86 sincronizados

    servidores   1
    comandos     1
    emojis       86
    presencia    sin actividad

  listo en 1.4 s
```

Los colores degradan a texto plano cuando la salida no es un TTY (`docker logs`,
systemd, redireccion a archivo) o cuando `NO_COLOR` esta definido.

## Convenciones

- Todo envio lleva `flags: MessageFlags.IsComponentsV2`. Sin el flag, Discord
  responde `Invalid Form Body`.
- Las respuestas efimeras combinan flags con OR: `ui.V2_EFIMERO`. `ephemeral:
  true` esta obsoleto.
- Los `customId` siguen el esquema `dominio:accion:dato`. El enrutador de
  `events/interactionCreate.js` reparte por dominio a `client.sistemas`, asi que
  no crece al anadir modulos.
- Cada handler de interaccion responde a los fallos con un Container, nunca con
  texto plano.
