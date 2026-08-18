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
        logger.paso('session', client.user.tag);

        const { creados, existentes, fallidos } = await client.emojiManager.sync();
        logger.paso('emojis', `${creados + existentes} synchronized`);
        if (creados) logger.detalle(`${creados} uploaded for the first time`);
        if (fallidos.length) logger.detalle(`not uploaded: ${fallidos.join(', ')}`);

        const emojis = client.emojiManager;

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
                logger.error('systems', `'${nombre}' failed to start: ${error.message}`);
                logger.traza(`systems:${nombre}`, error);
            }
        };

        await arrancar('log', () => client.sistemas.log.registrar());
        await arrancar('verify', () => client.sistemas.verify.iniciar());
        await arrancar('sellauth', () => client.sistemas.sellauth.iniciar());
        await arrancar('shop', () => client.sistemas.shop.iniciar());
        await arrancar('rules', () => client.sistemas.rules.iniciar());
        await arrancar('status', () => client.sistemas.status.iniciar());
        await arrancar('welcome', () => client.sistemas.welcome.iniciar());
        await arrancar('ticket', () => client.sistemas.ticket.iniciar());
        await arrancar('automod', () => client.sistemas.automod.iniciar());
        await arrancar('sorteo', () => client.sistemas.sorteo.iniciar());
        await arrancar('encuesta', () => client.sistemas.encuesta.iniciar());
        await arrancar('programados', () => client.sistemas.programados.iniciar());
        await arrancar('mant', () => client.sistemas.mant.iniciar());

        client.sistemasDegradados = degradados;
        logger.paso('systems', Object.keys(client.sistemas).join(' · '));
        if (degradados.length) {
            logger.warn('systems', `${degradados.length} degraded: ${degradados.join(', ')}`);
            alertas.aviso('arranque', `El bot arranco con subsistemas degradados: ${degradados.join(', ')}.`);
        }

        client.api = new ApiServer(client, emojis);
        client.api.iniciar();

        try {
            const total = await client.desplegarComandos();
            logger.paso('commands', `${total} commands · ${process.env.GUILD_ID ? 'guild' : 'global'}`);
            if (!process.env.GUILD_ID) {
                logger.detalle('without GUILD_ID, global propagation can take up to 1 hour');
            }
        } catch (error) {
            logger.error('commands', `Could not deploy commands: ${error.message}`);
        }

        const presencia = aplicarPresencia(client);
        const activos = Object.keys(client.sistemas.ticket.db.data.activos).length;
        const catalogo = client.sistemas.shop.visibles().length;

        logger.resumen([
            ['servers', String(client.guilds.cache.size)],
            ['commands', String(client.commands.size)],
            ['emojis', String(Object.keys(emojis.all()).length)],
            ['tickets', `${activos} open`],
            ['catalog', `${catalogo} published`],
            ['presence', presencia.actividad ? 'active' : 'no activity'],
            ['health', degradados.length ? `${degradados.length} degraded` : 'all operational']
        ]);
        client.sistemasListos = true;
        client.confirmarArranque?.();
        logger.listo();
    }
};
