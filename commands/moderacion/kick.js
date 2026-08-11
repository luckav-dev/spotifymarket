'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const permisos = require('../../utils/permisos');
const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member to kick').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for the kick').setRequired(true).setMaxLength(400)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const objetivo = interaction.options.getMember('user');
        const usuario = interaction.options.getUser('user');
        const motivo = interaction.options.getString('reason');

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

        await client.sistemas.mod.notificar(usuario, {
            titulo: 'You have been removed from the server',
            emoji: 'kick',
            guild: interaction.guild,
            motivo
        });

        try {
            await objetivo.kick(`${motivo} · por ${interaction.user.tag}`);
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No he podido expulsarlo: ${error.message}`)],
                flags: ui.V2
            });
        }

        await client.sistemas.log?.sancion({
            accion: 'Usuario expulsado',
            emoji: 'kick',
            objetivo: usuario,
            moderador: interaction.user,
            motivo
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `<@${usuario.id}> expulsado.\n-# ${motivo}`)],
            flags: ui.V2
        });
    }
};
