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
const SellAuthPaymentWatcher = require('../modules/sellAuthPaymentWatcher');
const WelcomeSystem = require('../modules/welcomeSystem');
const RulesSystem = require('../modules/rulesSystem');
const StatusSystem = require('../modules/statusSystem');
const SuggestionSystem = require('../modules/suggestionSystem');
const ApiServer = require('../modules/apiServer');

module.exports = {
    name: Events.ClientReady,
    once: true,

    async execute(client) {
        logger.paso('sesion', client.user.tag);

        const { creados, existentes, fallidos } = await client.emojiManager.sync();
        logger.paso('emojis', `${creados + existentes} sincronizados`);
        if (creados) logger.detalle(`${creados} subidos por primera vez`);
        if (fallidos.length) logger.detalle(`no subidos: ${fallidos.join(', ')}`);

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

        // El constructor ya conecta los pagos del webhook con el container nuevo.
        // El polling es solo respaldo, por eso se retrasa para no competir con la
        // sincronizacion inicial de productos/resenas por el rate limit de SellAuth.
        client.sellauthPayments = new SellAuthPaymentWatcher(client, emojis);

        client.sistemas.log.registrar();
        client.sistemas.verify.iniciar();
        await client.sistemas.sellauth.iniciar();

        const paymentWatcherDelayMs = 65000;
        client.sellauthPaymentsStartTimer = setTimeout(() => {
            client.sellauthPaymentsStartTimer = null;
            client.sellauthPayments.iniciar();
        }, paymentWatcherDelayMs);
        client.sellauthPaymentsStartTimer.unref?.();
        logger.detalle(`Payment watcher de respaldo arrancara en ${Math.round(paymentWatcherDelayMs / 1000)}s para respetar el rate limit.`);

        client.sistemas.shop.iniciar();
        client.sistemas.rules.iniciar();
        await client.sistemas.welcome.iniciar();
        await client.sistemas.ticket.iniciar();

        logger.paso('sistemas', Object.keys(client.sistemas).join(' · '));

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
            ['presencia', presencia.actividad ? 'activa' : 'sin actividad']
        ]);
        logger.listo();
    }
};
