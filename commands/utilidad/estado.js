'use strict';

const { SlashCommandBuilder } = require('discord.js');
const permisos = require('../../utils/permisos');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show the current service status')
        .setDMPermission(false),

    async execute(interaction, { client, emojis, ui }) {
        const sistema = client.sistemas?.status;
        if (!sistema?.config?.activo) {
            return ui.responderEfimero(interaction, ui.aviso(emojis, 'Service status is currently unavailable.'));
        }
        const controles = permisos.puede(interaction.member, 'estadoServicio');
        return interaction.reply(sistema.construirPanel({ controles, efimero: true }));
    }
};
