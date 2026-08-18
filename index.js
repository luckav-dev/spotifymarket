'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Options, REST, Routes, Partials } = require('discord.js');

const logger = require('./utils/logger');
const config = require('./utils/config');
const EmojiManager = require('./utils/emojiManager');
const Database = require('./utils/jsonDatabase');
const ui = require('./utils/ui');
const alertas = require('./utils/alertas');
const supervision = require('./utils/supervision');

const { version: versionDjs } = require('discord.js');
const paquete = require('./package.json');

const ajustes = config.cargar('bot');

/** Variables sin las que el bot no puede arrancar. */
const REQUERIDAS = ['DISCORD_TOKEN', 'CLIENT_ID'];
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_MAX_NOT_READY_MS = 180_000;
const LATIDO_INTERVAL_MS = 60_000;

/**
 * Errores que si obligan a reiniciar: el proceso ya no puede confiar en su
 * propio estado. Cualquier otra excepcion no capturada se registra y se sigue,
 * porque un fallo en un handler de interaccion no puede tumbar el servicio
 * entero para todo el servidor.
 */
const FATALES = new Set(['ERR_WORKER_OUT_OF_MEMORY', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);

function esFatal(error) {
    if (!error) return false;
    if (FATALES.has(error.code)) return true;
    if (error instanceof RangeError && /call stack/i.test(error.message ?? '')) return true;
    return /heap out of memory|out of memory/i.test(error.message ?? '');
}

function comprobarEntorno() {
    const faltan = REQUERIDAS.filter(clave => !process.env[clave]?.trim());
    if (!faltan.length) return;

    logger.error('entorno', `Faltan variables en .env: ${faltan.join(', ')}`);
    logger.detalle('Copia .env.example a .env y rellena esos valores.');
    process.exit(1);
}

/** Traduce los nombres de config/bot.json a los bits reales de la gateway. */
function resolverIntents() {
    const nombres = ajustes.intents?.length ? ajustes.intents : ['Guilds'];
    const bits = [];

    for (const nombre of nombres) {
        const bit = GatewayIntentBits[nombre];
        if (bit === undefined) {
            logger.warn('intents', `'${nombre}' no es un intent valido, se ignora.`);
            continue;
        }
        bits.push(bit);
    }

    return bits;
}

/**
 * Limites de cache explicitos.
 *
 * Con GuildMembers y GuildVoiceStates activos, discord.js cachea sin techo por
 * defecto y la memoria del proceso crece durante dias hasta que el kernel lo
 * mata. Se cachea lo que el bot consulta de verdad y se barre el resto.
 */
const client = new Client({
    intents: resolverIntents(),
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
    makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 200,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        GuildInviteManager: 0,
        ThreadManager: 100,
        AutoModerationRuleManager: 0
    }),
    sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: { interval: 900, lifetime: 3600 },
        threads: { interval: 3600, lifetime: 14400 },
        users: {
            interval: 3600,
            filter: () => usuario => usuario.id !== usuario.client.user.id
        }
    }
});

client.commands = new Collection();
client.cooldowns = new Collection();
client.emojiManager = new EmojiManager(client);
client.config = config;
client.logger = logger;
client.ui = ui;
client.sistemasListos = false;

/** Carga recursiva de commands/, agrupados por subcarpeta de dominio. */
function cargarComandos(dir = path.join(__dirname, 'commands')) {
    if (!fs.existsSync(dir)) return;

    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, entrada.name);

        if (entrada.isDirectory()) {
            cargarComandos(ruta);
            continue;
        }
        if (!entrada.name.endsWith('.js')) continue;

        const comando = require(ruta);
        if (comando?.data?.name && typeof comando.execute === 'function') {
            client.commands.set(comando.data.name, comando);
        } else {
            logger.warn('comandos', `${entrada.name} no exporta { data, execute }`);
        }
    }
}

/** Carga events/, cada archivo exporta { name, once?, execute }. */
function cargarEventos() {
    const dir = path.join(__dirname, 'events');
    if (!fs.existsSync(dir)) return 0;

    const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

    for (const archivo of archivos) {
        const evento = require(path.join(dir, archivo));
        const handler = (...args) => {
            try {
                Promise.resolve(evento.execute(...args, client)).catch(error =>
                    logger.traza(`evento:${evento.name}`, error)
                );
            } catch (error) {
                logger.traza(`evento:${evento.name}`, error);
            }
        };

        if (evento.once) client.once(evento.name, handler);
        else client.on(evento.name, handler);
    }

    return archivos.length;
}

async function desplegarComandos() {
    const cuerpo = [...client.commands.values()].map(c => c.data.toJSON());
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    // Con GUILD_ID el despliegue es instantaneo; sin el, global y tarda ~1h.
    const ruta = process.env.GUILD_ID
        ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
        : Routes.applicationCommands(process.env.CLIENT_ID);

    await rest.put(ruta, { body: cuerpo });
    return cuerpo.length;
}

client.desplegarComandos = desplegarComandos;

let apagando = false;
let watchdog = null;
let latido = null;
let noReadyDesde = 0;
let degradadoAvisado = false;

function registrarDiagnosticoDiscord() {
    client.on('error', error => logger.traza('discord:error', error));
    client.on('warn', aviso => logger.warn('discord', aviso));
    client.on('shardError', error => logger.traza('discord:shard', error));
    client.on('shardDisconnect', (evento, shardId) => {
        logger.warn('discord', `Shard ${shardId} desconectado (${evento?.code ?? 'sin codigo'}).`);
    });
    client.on('shardReconnecting', shardId => {
        logger.warn('discord', `Shard ${shardId} reconectando...`);
    });
    client.on('shardResume', (shardId, eventosReproducidos) => {
        logger.info('discord', `Shard ${shardId} reanudado · ${eventosReproducidos} eventos reproducidos.`);
    });
}

function iniciarWatchdog() {
    if (watchdog) clearInterval(watchdog);
    noReadyDesde = 0;

    watchdog = setInterval(() => {
        if (apagando) return;

        const discordListo = client.isReady();
        const sistemasListos = client.sistemasListos === true;
        if (discordListo && sistemasListos) {
            noReadyDesde = 0;
            return;
        }

        if (!noReadyDesde) {
            noReadyDesde = Date.now();
            return;
        }

        const desconectadoMs = Date.now() - noReadyDesde;
        const motivo = !discordListo ? 'Discord no esta listo' : 'los subsistemas no terminaron de iniciar';

        // Se avisa a mitad de camino: si la gateway se recupera sola no hace
        // falta reiniciar, pero el equipo tiene que enterarse igualmente.
        if (!degradadoAvisado && desconectadoMs >= WATCHDOG_MAX_NOT_READY_MS / 2) {
            degradadoAvisado = true;
            alertas.aviso('watchdog', `${motivo} desde hace ${Math.round(desconectadoMs / 1000)} s. Si no se recupera, se reiniciara.`);
        }

        if (desconectadoMs < WATCHDOG_MAX_NOT_READY_MS) return;

        logger.error('watchdog', `${motivo} desde hace ${Math.round(desconectadoMs / 1000)} s. Forzando reinicio supervisado.`);
        alertas.disparar('critico', 'watchdog', `${motivo} desde hace ${Math.round(desconectadoMs / 1000)} s. Reiniciando el proceso.`, { forzar: true });
        apagar('watchdog', 1);
    }, WATCHDOG_INTERVAL_MS);

    watchdog.unref?.();
}

/**
 * Latido a un monitor externo. Es lo unico que detecta el peor fallo posible:
 * que el proceso muera del todo y no quede nadie dentro para avisar.
 */
function iniciarLatido() {
    if (latido) clearInterval(latido);

    const enviar = () => {
        if (apagando) return;
        const sano = client.isReady() && client.sistemasListos === true;
        alertas.latido(sano ? '' : 'fail').catch(() => {});
    };

    enviar();
    latido = setInterval(enviar, LATIDO_INTERVAL_MS);
    latido.unref?.();
}

/** Marca el arranque como bueno y avisa si venia de un bucle de fallos. */
function confirmarArranque() {
    const estado = supervision.arranqueCorrecto();
    degradadoAvisado = false;
    if (estado.recuperadoDe) {
        alertas.recuperado('arranque', `El bot volvio a arrancar correctamente tras ${estado.recuperadoDe} intento(s) fallido(s).`);
    }
}

client.confirmarArranque = confirmarArranque;

async function arrancar() {
    logger.cabecera('Spotify Market', paquete.version, `discord.js ${versionDjs} · node ${process.version}`);

    const historial = supervision.abrirArranque();
    if (historial.fallosConsecutivos) {
        logger.warn('supervision', `Reintento ${historial.fallosConsecutivos} tras: ${historial.ultimoMotivo || 'motivo desconocido'}`);
    }

    comprobarEntorno();

    cargarComandos();
    logger.paso('comandos', `${client.commands.size} cargados`);

    const eventos = cargarEventos();
    logger.paso('eventos', `${eventos} registrados`);

    registrarDiagnosticoDiscord();

    try {
        await client.login(process.env.DISCORD_TOKEN);
        iniciarWatchdog();
        iniciarLatido();
    } catch (error) {
        if (error.code === 'DisallowedIntents') {
            logger.error('conexion', 'Discord ha rechazado los intents privilegiados.');
            logger.detalle('Activalos en el portal: Bot > Privileged Gateway Intents.');
        } else if (error.code === 'TokenInvalid') {
            logger.error('conexion', 'El DISCORD_TOKEN del .env no es valido.');
        } else {
            logger.traza('conexion', error);
        }
        return apagar(`conexion:${error.code ?? 'desconocido'}`, 1);
    }
}

/**
 * Apagado limpio. Los fallos fatales salen con codigo 1 para que systemd
 * (Restart=on-failure/always) los levante de nuevo en vez de considerarlos
 * una parada correcta.
 */
function apagar(senal, codigo = 0) {
    if (apagando) return;
    apagando = true;

    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    if (latido) clearInterval(latido);
    latido = null;

    logger.aire();
    logger.info('bot', `Recibido ${senal}, cerrando...`);

    // Solo las salidas en error cuentan como fallo: un SIGTERM de un despliegue
    // no debe activar el freno de reinicios.
    let espera = 0;
    if (codigo !== 0) {
        const { fallos, esperaMs } = supervision.arranqueFallido(senal);
        espera = esperaMs;
        alertas.disparar('critico', 'apagado', `El bot se apaga por \`${senal}\`. Fallo consecutivo numero ${fallos}.`, { forzar: true });
        alertas.latido('fail');
        if (espera) {
            logger.warn('supervision', `${fallos} fallos seguidos: se retrasa la salida ${Math.round(espera / 1000)} s para frenar el bucle de reinicios.`);
        }
    }

    const salidaForzada = setTimeout(() => process.exit(codigo), 10_000);
    salidaForzada.unref?.();

    try {
        client.api?.detener();
    } catch (error) {
        logger.traza('apagado:api', error);
    }

    try {
        client.sistemas?.sellauth?.detener();
    } catch (error) {
        logger.traza('apagado:sellauth', error);
    }

    try {
        Database.flushAll();
        logger.ok('db', 'Datos volcados a disco');
    } catch (error) {
        logger.traza('apagado:db', error);
    }

    try {
        client.destroy();
        logger.ok('bot', 'Desconectado');
    } catch (error) {
        logger.traza('apagado:discord', error);
    }

    // El retraso lo aplica el propio proceso, no el supervisor: asi el freno
    // funciona igual con systemd, con Docker o con pm2, sin configurar nada.
    // Atomics.wait es la unica espera sincrona real de Node: aqui no se puede
    // ceder el control al bucle de eventos porque ya no va a volver.
    if (espera) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera);
    }

    process.exit(codigo);
}

for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => apagar(senal, 0));
}

// SIGHUP: relee la configuracion sin reiniciar. Un cambio de textos o de IDs no
// deberia costar una desconexion del gateway.
process.on('SIGHUP', () => {
    logger.info('bot', 'Recibido SIGHUP, recargando configuracion...');
    try {
        for (const nombre of config.nombres()) config.recargar(nombre);
        logger.ok('config', 'Configuracion recargada desde disco');
    } catch (error) {
        logger.traza('sighup', error);
    }
});

process.on('unhandledRejection', error => logger.traza('unhandled', error));
process.on('warning', warning => logger.traza('process:warning', warning));

/**
 * Una excepcion no capturada ya no apaga el bot por defecto.
 *
 * Casi siempre viene de un handler de interaccion suelto, y matar el proceso
 * por eso deja sin servicio a todo el servidor por el fallo de un usuario. Solo
 * se reinicia cuando el proceso no puede seguir confiando en su estado.
 */
process.on('uncaughtException', error => {
    logger.traza('uncaught', error);

    if (esFatal(error)) {
        alertas.disparar('critico', 'uncaught', `Error irrecuperable: ${error.message}`, { forzar: true });
        return apagar('uncaughtException', 1);
    }

    alertas.aviso('uncaught', `Excepcion no capturada contenida (el bot sigue en pie): ${error.message}`);
});

arrancar().catch(error => {
    logger.traza('arranque:fatal', error);
    apagar('startupFailure', 1);
});
