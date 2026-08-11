'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show the current service status')
        .setDMPermission(false),

    async execute(interaction, { client, emojis, ui }) {
        const sistema = client.sistemas?.status;
        if (!sistema?.config?.activo) {
            return ui.responderEfimero(interaction, ui.aviso(emojis, 'El estado del servicio no está disponible.'));
        }
        return interaction.reply(sistema.construirPanel({ controles: false, efimero: true }));
    }
};
