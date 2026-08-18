'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');

const logger = require('./utils/logger');
const config = require('./utils/config');
const EmojiManager = require('./utils/emojiManager');
const Database = require('./utils/jsonDatabase');
const ui = require('./utils/ui');

const { version: versionDjs } = require('discord.js');
const paquete = require('./package.json');

const ajustes = config.cargar('bot');

/** Variables sin las que el bot no puede arrancar. */
const REQUERIDAS = ['DISCORD_TOKEN', 'CLIENT_ID'];
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_MAX_NOT_READY_MS = 180_000;

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

const client = new Client({ intents: resolverIntents() });

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
let noReadyDesde = 0;

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
        if (desconectadoMs < WATCHDOG_MAX_NOT_READY_MS) return;

        const motivo = !discordListo ? 'Discord no esta listo' : 'los subsistemas no terminaron de iniciar';
        logger.error('watchdog', `${motivo} desde hace ${Math.round(desconectadoMs / 1000)} s. Forzando reinicio supervisado.`);
        apagar('watchdog', 1);
    }, WATCHDOG_INTERVAL_MS);

    watchdog.unref?.();
}

async function arrancar() {
    logger.cabecera('Spotify Market', paquete.version, `discord.js ${versionDjs} · node ${process.version}`);

    comprobarEntorno();

    cargarComandos();
    logger.paso('comandos', `${client.commands.size} cargados`);

    const eventos = cargarEventos();
    logger.paso('eventos', `${eventos} registrados`);

    registrarDiagnosticoDiscord();

    try {
        await client.login(process.env.DISCORD_TOKEN);
        iniciarWatchdog();
    } catch (error) {
        if (error.code === 'DisallowedIntents') {
            logger.error('conexion', 'Discord ha rechazado los intents privilegiados.');
            logger.detalle('Activalos en el portal: Bot > Privileged Gateway Intents.');
        } else if (error.code === 'TokenInvalid') {
            logger.error('conexion', 'El DISCORD_TOKEN del .env no es valido.');
        } else {
            logger.traza('conexion', error);
        }
        process.exit(1);
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

    logger.aire();
    logger.info('bot', `Recibido ${senal}, cerrando...`);

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

    process.exit(codigo);
}

for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => apagar(senal, 0));
}

process.on('unhandledRejection', error => logger.traza('unhandled', error));
process.on('warning', warning => logger.traza('process:warning', warning));
process.on('uncaughtException', error => {
    logger.traza('uncaught', error);
    apagar('uncaughtException', 1);
});

arrancar().catch(error => {
    logger.traza('arranque:fatal', error);
    apagar('startupFailure', 1);
});
