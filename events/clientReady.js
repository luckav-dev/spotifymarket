'use strict';

const { Events } = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const alertas = require('../utils/alertas');
const { aplicarPresencia } = require('../utils/presencia');

const TicketSystem = require('../modules/ticketSystem');
const LogSystem = require('../modules/logSystem');
const VerifySystem = require('../modules/verifySystem');
const ModerationSystem = require('../modules/moderationSystem');
const ShopSystem = require('../modules/shopSystem');
const SellAuthSystem = require('../modules/minimalSellAuthAnnouncements');
const WelcomeSystem = require('../modules/welcomeSystem');
const RulesSystem = require('../modules/rulesSystem');
const StatusSystem = require('../modules/statusSystem');
const SuggestionSystem = require('../modules/suggestionSystem');
const AutoModSystem = require('../modules/autoModSystem');
const GiveawaySystem = require('../modules/giveawaySystem');
const PollSystem = require('../modules/pollSystem');
const SchedulerSystem = require('../modules/schedulerSystem');
const MaintenanceSystem = require('../modules/maintenanceSystem');
const ApiServer = require('../modules/apiServer');

module.exports = {
    name: Events.ClientReady,
    once: true,

    async execute(client) {
        client.sistemasListos = false;
        logger.paso('sesion', client.user.tag);

        const { creados, existentes, fallidos } = await client.emojiManager.sync();
        logger.paso('emojis', `${creados + existentes} sincronizados`);
        if (creados) logger.detalle(`${creados} subidos por primera vez`);
        if (fallidos.length) logger.detalle(`no subidos: ${fallidos.join(', ')}`);

        const emojis = client.emojiManager;

        // Las claves son el dominio del customId: interactionCreate reparte por
        // el prefijo, sin conocer ningun sistema en concreto.
        client.sistemas = {
            ticket: new TicketSystem(client, emojis),
            verify: new VerifySystem(client, emojis),
            sellauth: new SellAuthSystem(client, emojis),
            shop: new ShopSystem(client, emojis),
            welcome: new WelcomeSystem(client, emojis),
            rules: new RulesSystem(client, emojis),
            status: new StatusSystem(client, emojis),
            suggest: new SuggestionSystem(client, emojis),
            sorteo: new GiveawaySystem(client, emojis),
            encuesta: new PollSystem(client, emojis),
            mant: new MaintenanceSystem(client, emojis),
            log: new LogSystem(client, emojis),
            mod: new ModerationSystem(client, emojis),

            // Sin dominio de customId propio: no atienden interacciones, pero
            // viven aqui para que el resto de sistemas puedan preguntarles.
            automod: new AutoModSystem(client, emojis),
            programados: new SchedulerSystem(client, emojis)
        };

        // Cada subsistema arranca aislado: si SellAuth esta caido o a un canal
        // le falta un permiso, el bot tiene que quedarse en pie igualmente. Un
        // throw aqui dejaba sistemasListos en false y el watchdog reiniciaba en
        // bucle sin que nadie se enterase.
        const degradados = [];
        const arrancar = async (nombre, tarea) => {
            try {
                await tarea();
            } catch (error) {
                degradados.push(nombre);
                logger.error('sistemas', `'${nombre}' no arranco: ${error.message}`);
                logger.traza(`sistemas:${nombre}`, error);
            }
        };

        await arrancar('log', () => client.sistemas.log.registrar());
        await arrancar('verify', () => client.sistemas.verify.iniciar());
        await arrancar('sellauth', () => client.sistemas.sellauth.iniciar());
        await arrancar('shop', () => client.sistemas.shop.iniciar());
        await arrancar('rules', () => client.sistemas.rules.iniciar());
        await arrancar('welcome', () => client.sistemas.welcome.iniciar());
        await arrancar('ticket', () => client.sistemas.ticket.iniciar());
        await arrancar('automod', () => client.sistemas.automod.iniciar());
        await arrancar('sorteo', () => client.sistemas.sorteo.iniciar());
        await arrancar('encuesta', () => client.sistemas.encuesta.iniciar());
        await arrancar('programados', () => client.sistemas.programados.iniciar());
        await arrancar('mant', () => client.sistemas.mant.iniciar());

        client.sistemasDegradados = degradados;
        logger.paso('sistemas', Object.keys(client.sistemas).join(' · '));
        if (degradados.length) {
            logger.warn('sistemas', `${degradados.length} degradado(s): ${degradados.join(', ')}`);
            alertas.aviso('arranque', `El bot arranco con subsistemas degradados: ${degradados.join(', ')}.`);
        }

        // Fuera de client.sistemas a proposito: ahi solo van los dominios de
        // customId que enruta interactionCreate, y la API no atiende ninguno.
        client.api = new ApiServer(client, emojis);
        client.api.iniciar();

        try {
            const total = await client.desplegarComandos();
            logger.paso('despliegue', `${total} comandos · ${process.env.GUILD_ID ? 'gremio' : 'global'}`);
            if (!process.env.GUILD_ID) {
                logger.detalle('sin GUILD_ID la propagacion global tarda hasta 1 h');
            }
        } catch (error) {
            logger.error('despliegue', `no se pudieron desplegar: ${error.message}`);
        }

        const presencia = aplicarPresencia(client);
        const activos = Object.keys(client.sistemas.ticket.db.data.activos).length;
        const catalogo = client.sistemas.shop.visibles().length;

        logger.resumen([
            ['servidores', String(client.guilds.cache.size)],
            ['comandos', String(client.commands.size)],
            ['emojis', String(Object.keys(emojis.all()).length)],
            ['tickets', `${activos} abiertos`],
            ['catalogo', `${catalogo} publicados`],
            ['presencia', presencia.actividad ? 'activa' : 'sin actividad'],
            ['estado', degradados.length ? `${degradados.length} degradado(s)` : 'todo operativo']
        ]);
        client.sistemasListos = true;
        client.confirmarArranque?.();
        logger.listo();
    }
};
