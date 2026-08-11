'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a proposal for community review')
        .setDMPermission(false),

    async execute(interaction, { client, emojis, ui }) {
        const sistema = client.sistemas?.suggest;
        if (!sistema) return ui.responderEfimero(interaction, ui.error(emojis, 'The suggestion system is currently unavailable.'));
        return sistema.abrirModal(interaction);
    }
};
