'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildMemberAdd,

    async execute(member, client) {
        try {
            await client.sistemas?.welcome?.darBienvenida(member);
        } catch (error) {
            logger.traza('guildMemberAdd', error);
        }
    }
};
