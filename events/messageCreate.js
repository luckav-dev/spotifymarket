'use strict';

const { Events } = require('discord.js');

const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageCreate,

    async execute(mensaje, client) {
        if (mensaje.author.bot || !mensaje.guild) return;

        try {
            // La auto-moderacion va primero: si el mensaje se borra, no tiene
            // sentido contarlo como actividad del ticket.
            const moderado = await client.sistemas?.automod?.revisar(mensaje);
            if (moderado) return;

            await client.sistemas?.ticket?.registrarActividad(mensaje);
        } catch (error) {
            logger.traza('messageCreate', error);
        }
    }
};
