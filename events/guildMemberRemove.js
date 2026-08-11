'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildMemberRemove,

    async execute(member, client) {
        try {
            await client.sistemas?.welcome?.despedir(member);
        } catch (error) {
            logger.traza('guildMemberRemove', error);
        }
    }
};
