# Dashboard

Panel web de administracion del bot: operaciones de tickets y moderacion,
catalogo, compositor de anuncios en Components V2, publicacion de paneles y
edicion de toda la configuracion.

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui sobre Base UI.

## Como encaja con el bot

El dashboard **no toca los archivos de `config/` del bot directamente**. Habla
por HTTP con la API local que expone `modules/apiServer.js` (ver el README del
bot), autenticada con un token compartido. Esa API guarda de forma atomica y
refresca la cache del bot en el mismo paso, asi que un cambio hecho aqui se
aplica sin reiniciar el bot.

El token de la API (`BOT_API_TOKEN` / `BOT_API_URL`) solo se lee en modulos
`server-only` (`src/lib/api.ts`, `src/lib/discord.ts`, `src/lib/sesion.ts`) y
en Server Actions: nunca llega al navegador.

## Puesta en marcha

```bash
npm install
cp .env.local.example .env.local   # rellena los valores
npm run dev
```

Variables de `.env.local`:

| Variable | De donde sale |
|---|---|
| `BOT_API_URL` | URL de la API del bot. Por defecto `http://127.0.0.1:8787` |
| `BOT_API_TOKEN` | El mismo valor que `DASHBOARD_TOKEN` en el `.env` del bot |
| `SESSION_SECRET` | Aleatorio, al menos 32 caracteres. `openssl rand -hex 32` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Portal de desarrolladores > tu aplicacion > OAuth2 |
| `DISCORD_REDIRECT_URI` | Tiene que coincidir exactamente con un redirect registrado en el portal |

## Autenticacion

OAuth2 de Discord, scope minimo (`identify`, nada de `guilds.members.read`):
el nivel de staff lo resuelve el propio bot contra `config/permissions.json`
a traves de `GET /api/acceso/:id`, asi que el dashboard no necesita pedir mas
permiso del que hace falta.

La comprobacion esta partida en dos capas, siguiendo lo que Next.js recomienda
para Proxy (antes "Middleware"):

- **`src/proxy.ts`** hace la comprobacion optimista: si no hay cookie de
  sesion, redirige a `/login` antes de tocar nada. Proxy no esta pensado para
  I/O lento ni como solucion completa de sesion, asi que no valida la firma
  aqui.
- **`src/app/(dashboard)/layout.tsx`** hace la comprobacion real, en el
  servidor: deserializa la cookie, valida la firma HMAC y la caducidad. Si
  algo no cuadra, fuera.

Cada Server Action vuelve a llamar a `requerirSesion()` por su cuenta: una
Server Action es un endpoint propio que se podria invocar sin pasar por la
pagina, asi que no basta con que el layout proteja la pantalla.

La sesion es una cookie `httpOnly` firmada con HMAC-SHA256 (no JWT: el
contenido no es secreto, solo tiene que ser infalsificable, y asi no hace
falta arrastrar una libreria mas). Dura 8 horas.

## Estructura

```
src/proxy.ts                  Comprobacion optimista de sesion (ver arriba)
src/app/login/                Pagina de login y arranque del OAuth
src/app/auth/                 Callback de Discord y logout
src/app/(dashboard)/          Todo lo protegido, con su propio layout
  inicio/                     Estado del bot en vivo
  tickets/                    Busqueda y detalle de tickets activos/archivados
  moderacion/                 Historial y filtros de avisos de moderacion
  catalogo/                   CRUD de productos
  anuncios/                   Compositor de bloques V2 con vista previa
  paneles/                    Publicar/actualizar los paneles de cada sistema
  configuracion/              Editor generico de los config/*.json del bot
src/lib/api.ts                Cliente de la API del bot (server-only)
src/lib/sesion.ts             Cookie de sesion firmada (server-only)
src/lib/discord.ts            OAuth2 de Discord (server-only)
src/lib/json.ts               Tipos y helpers para el editor de configuracion
src/components/ui/            Componentes de shadcn/ui (Base UI por debajo)
src/components/dashboard/     Barra lateral, cabecera, tarjetas de estado
public/brand/                 Logos y banners originales de SpotifyMarket
```

El dashboard usa un tema fijo negro/verde, Onest para la interfaz, Bebas Neue
para titulares y JetBrains Mono para IDs y metricas. Los recursos de
`public/brand/` son copias byte por byte de los archivos de marca originales.

## El compositor de anuncios

Los bloques (titulo, texto, separador, imagenes, seccion, botones) siguen el
mismo esquema declarativo que `utils/constructorV2.js` en el bot: el
dashboard no genera el Container V2, se lo describe al bot y el bot lo
construye y lo valida contra los limites reales de Discord (4000 caracteres,
40 componentes, 5 filas...). La vista previa de la izquierda es una
aproximacion visual, no una simulacion exacta.

## El editor de configuracion

`src/app/(dashboard)/configuracion` no tiene una pantalla distinta por cada
archivo. Es un editor recursivo: objetos se ven como filas clave/valor,
arrays de texto como listas con anadir/quitar, arrays de objetos como
tarjetas repetibles. Al anadir una clave nueva a un diccionario (un rol de
staff, una categoria de ticket...) clona la forma de una entrada hermana en
vez de dejar un objeto vacio.

Para lo que ese heuristico no puede resolver por si solo (un diccionario que
empieza vacio, sin ninguna entrada de la que copiar la forma), cada pantalla
tiene una pestana "JSON" con edicion directa como valvula de escape.

## Verificacion

`npx tsc --noEmit`, `npx eslint src` y `npx next build` limpios. Las rutas
protegidas `/inicio`, `/paneles`, `/tickets`, `/moderacion`, `/catalogo` y
`/configuracion` se han renderizado en produccion con una sesion firmada, sin
errores de consola ni overlays de Next.js. El flujo de
autenticacion completo (redirect sin sesion, login, redirect a Discord con el
scope minimo, validacion CSRF del `state`, sesion firmada llegando a una
pagina protegida con datos reales, firma manipulada rechazada, logout) esta
probado de extremo a extremo contra un bot simulado.
