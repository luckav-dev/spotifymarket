# spotifymarketbot

Bot de Discord de Spotify Market: soporte por tickets, moderación, registros,
catálogo SellAuth, facturas, reseñas verificadas, avisos de stock/precio,
bienvenida, estado del servicio y sugerencias.

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

Para conectar la tienda añade también `SELLAUTH_API_KEY`, `SELLAUTH_SHOP_ID` y
`SELLAUTH_WEBHOOK_SECRET`. La clave API se obtiene en **Account > Developers**
de SellAuth; el secreto de webhook, en **Storefront > Configure >
Miscellaneous**. Ninguno de esos secretos se guarda en `config/` ni se expone
al dashboard.

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
| `config/sellauth.json` | Sincronizacion, canales de reseñas/restocks/precios, webhook y textos publicos |
| `config/status.json` | Estados operativos, porcentaje, nota e historial del servicio |
| `config/suggestions.json` | Panel, canal, votos y estados de las sugerencias |
| `config/automod.json` | Filtros automáticos, acciones y protección antiraid |
| `config/sorteos.json` | Textos y límites de los sorteos |
| `config/encuestas.json` | Textos, opciones y duración de las encuestas |
| `config/programados.json` | Límites y cadencias de los mensajes programados |
| `config/mantenimiento.json` | Textos, presencia y excepciones del modo mantenimiento |

Los IDs y textos existentes se conservan como fuente de verdad. Los destinos
opcionales pueden quedarse vacíos hasta activarlos con `/setup`; `/diagnostics`
comprueba IDs, permisos, recursos y límites antes de que un fallo llegue a un
usuario. Cada guardado crea una copia automática en `config/backups/` y la API
rechaza configuraciones que Discord no podría publicar.

La interfaz pública está redactada en inglés. Los menús efímeros, registros y
respuestas que solo ve el equipo de administración se mantienen en español.

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

**Estado.** Panel público compacto, sin accent color, con resumen ASCII,
capacidad, nota operativa y una única referencia al cambio reciente. El panel
publicado no expone controles: el equipo autorizado los recibe en privado al
usar `/status`, y todos los paneles publicados se actualizan en sitio.

**Sugerencias.** Panel y comando `/suggest` con formulario, votos únicos por
usuario, cambio de voto, hilo opcional, estados configurables y respuesta
pública del equipo. La resolución puede notificarse al autor por mensaje
privado.

**Auto-moderación.** Filtros de invitaciones, enlaces fuera de la lista blanca,
patrones de estafa, spam por ventana deslizante, exceso de mayúsculas y de
menciones. Cada filtro elige su acción (borrar, timeout o aviso registrado) y
todo queda anotado. La protección antiraid cuenta las entradas por ventana y, al
superar el umbral, contiene automáticamente a quien llega mientras dura el
bloqueo y avisa al equipo. `/automod` muestra el estado y levanta el bloqueo.

**Sorteos.** `/giveaway` con requisitos comprobables: rol, antigüedad en el
servidor y haber comprado. Los requisitos se revisan otra vez al sortear, porque
entre participar y el sorteo la gente pierde roles o se va. El reparto usa
Fisher-Yates y avisa a los ganadores por mensaje privado.

**Encuestas.** `/poll` con hasta seis opciones, un voto por miembro, cambio de
voto y resultados en vivo o revelados al cerrar. El voto se guarda por usuario,
no como contador, así que no hay forma de votar dos veces.

**Mensajes programados.** `/schedule` guarda el mensaje como datos (los mismos
bloques que entiende `constructorV2`) y lo publica cuando toca, sobreviviendo a
reinicios. Admite repetición diaria, semanal o mensual, reintentos con espera
creciente y menciones solo si se pidieron al programar.

**Modo mantenimiento.** `/maintenance` pausa compras y apertura de tickets sin
apagar el bot, con aviso público, presencia propia y fin automático opcional. El
staff por encima del nivel configurado sigue operando con normalidad.

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
| `/ticket-history` | Gestionar canales | Busca en tickets abiertos y archivados por cliente, texto o categoría |
| `/automod` | Moderar miembros | Estado de los filtros, infracciones y bloqueo antiraid |
| `/giveaway` | Gestionar servidor | Crea, lista y resuelve sorteos con requisitos |
| `/poll` | Gestionar mensajes | Abre y cierra encuestas de la comunidad |
| `/schedule` | Gestionar servidor | Programa mensajes puntuales o recurrentes |
| `/maintenance` | Administrador | Pausa compras y tickets durante una incidencia |
| `/sellauth` | Administrador | Inspecciona y sincroniza la tienda SellAuth conectada |
| `/stock` | Administrador | Configura o refresca el tablón automático de stock |
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
- [x] **Fase 6 — Comunidad y resiliencia.** Auto-moderación con antiraid,
      sorteos, encuestas, mensajes programados, modo mantenimiento, niveles de
      cliente, avisos de restock, supervisión con alertas externas y CI.
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

`npm test` encadena dos cosas: `npm run check` valida sintaxis, los 19 esquemas
de configuración, emojis, comandos duplicados y la ausencia de accent color en
Components V2; `npm run unit` ejecuta las pruebas de `test/` con el runner de
Node.

## Despliegue y vigilancia

El bot sale con código 1 en todo fallo fatal y el watchdog fuerza esa salida
cuando lleva tres minutos sin estar operativo. **Eso solo funciona si hay un
supervisor detrás**: la unidad de systemd está en `deploy/spotifymarket.service`
y las instrucciones completas, en `deploy/README.md`.

Dos variables opcionales del `.env` cierran el círculo: `ALERT_WEBHOOK_URL`
manda caídas y arranques degradados a un canal privado, y `HEALTHCHECK_URL`
recibe un latido cada minuto, que es lo único capaz de detectar que el proceso
murió del todo. Hay además un `GET /health` sin token en la API local.

## Consola

El arranque usa una cabecera compacta, niveles alineados y un resumen operativo
final. Después de iniciar, cada evento incorpora hora, nivel y ámbito; las
trazas se limitan a las líneas útiles para que un fallo no entierre el contexto.

```
  +======================================================================+
  | Spotify Market  v0.1.0                                             |
  | discord.js 14.27.0 · node v22.22.2                                 |
  +======================================================================+
  INICIO  Validando servicios y recursos de Discord

  OK     comandos      22 cargados
  OK     eventos       14 registrados

  +----------------------------------------------------------------------+
  | RESUMEN OPERATIVO                                                  |
  | SERVIDORES  1                                                      |
  | COMANDOS    22                                                     |
  | EMOJIS      86                                                     |
  +----------------------------------------------------------------------+
  | Bot operativo · arranque 1.4 s                                    |
  +======================================================================+
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
