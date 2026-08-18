'use strict';

const { Events } = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
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
            log: new LogSystem(client, emojis),
            mod: new ModerationSystem(client, emojis)
        };

        client.sistemas.log.registrar();
        client.sistemas.verify.iniciar();
        await client.sistemas.sellauth.iniciar();
        client.sistemas.shop.iniciar();
        client.sistemas.rules.iniciar();
        client.sistemas.status.iniciar();
        await client.sistemas.welcome.iniciar();
        await client.sistemas.ticket.iniciar();

        logger.paso('systems', Object.keys(client.sistemas).join(' · '));

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
            ['presence', presencia.actividad ? 'active' : 'no activity']
        ]);
        client.sistemasListos = true;
        logger.listo();
    }
};
