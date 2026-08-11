'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-warning')
        .setDescription('Remove a warning from a member history')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member who owns the warning').setRequired(true))
        .addStringOption(o =>
            o.setName('warning').setDescription('Warning ID shown by /warnings').setRequired(true)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const usuario = interaction.options.getUser('user');
        const avisoId = interaction.options.getString('warning').trim();

        // Se desactiva, nunca se borra: el historial es la prueba de por que se
        // sanciono, y sin el no se puede revisar una apelacion.
        const aviso = client.sistemas.mod.desactivarAviso(usuario.id, avisoId);

        if (!aviso) {
            return interaction.editReply({
                components: [ui.error(emojis, `No hay ningun aviso activo con ID \`${avisoId}\` para ese usuario.`)],
                flags: ui.V2
            });
        }

        const activos = client.sistemas.mod.avisosDe(usuario.id).length;

        await client.sistemas.log?.sancion({
            accion: 'Aviso retirado',
            emoji: 'reply',
            objetivo: usuario,
            moderador: interaction.user,
            motivo: aviso.motivo,
            extra: { etiqueta: 'Avisos activos', valor: String(activos) }
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `Aviso \`${avisoId}\` retirado. A <@${usuario.id}> le quedan ${activos}.`)],
            flags: ui.V2
        });
    }
};
