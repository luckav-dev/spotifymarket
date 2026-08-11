'use strict';

const { Events } = require('discord.js');

const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageCreate,

    async execute(mensaje, client) {
        if (mensaje.author.bot || !mensaje.guild) return;

        try {
            await client.sistemas?.ticket?.registrarActividad(mensaje);
        } catch (error) {
            logger.traza('messageCreate', error);
        }
    }
};
