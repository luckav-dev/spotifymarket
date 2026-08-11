'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const permisos = require('../../utils/permisos');
const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member to ban').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for the ban').setRequired(true).setMaxLength(400))
        .addIntegerOption(o =>
            o.setName('delete_days')
                .setDescription('Days of message history to delete')
                .setMinValue(0)
                .setMaxValue(7)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const objetivo = interaction.options.getMember('user');
        const usuario = interaction.options.getUser('user');
        const motivo = interaction.options.getString('reason');
        const dias = interaction.options.getInteger('delete_days') ?? 0;

        if (!objetivo) {
            return interaction.editReply({
                components: [ui.error(emojis, 'Ese usuario no esta en el servidor.')],
                flags: ui.V2
            });
        }

        const rechazo = permisos.puedeActuarSobre(interaction.member, objetivo, interaction.guild.members.me);
        if (rechazo) {
            return interaction.editReply({ components: [ui.error(emojis, rechazo)], flags: ui.V2 });
        }

        // Notificar antes de ejecutar: despues de un ban ya no se le puede escribir.
        await client.sistemas.mod.notificar(usuario, {
            titulo: 'Has sido baneado',
            emoji: 'ban',
            guild: interaction.guild,
            motivo
        });

        try {
            await objetivo.ban({ reason: `${motivo} · por ${interaction.user.tag}`, deleteMessageSeconds: dias * 86400 });
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No he podido banearlo: ${error.message}`)],
                flags: ui.V2
            });
        }

        await client.sistemas.log?.sancion({
            accion: 'Usuario baneado',
            emoji: 'ban',
            objetivo: usuario,
            moderador: interaction.user,
            motivo
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `<@${usuario.id}> baneado.\n-# ${motivo}`)],
            flags: ui.V2
        });
    }
};
