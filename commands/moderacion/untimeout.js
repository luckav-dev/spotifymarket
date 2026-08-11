'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const permisos = require('../../utils/permisos');
const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove a member timeout')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member whose timeout will be removed').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for removing the timeout').setMaxLength(400)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const objetivo = interaction.options.getMember('user');
        const usuario = interaction.options.getUser('user');
        const motivo = interaction.options.getString('reason') ?? 'Retirado manualmente';

        if (!objetivo) {
            return interaction.editReply({
                components: [ui.error(emojis, 'Ese usuario no esta en el servidor.')],
                flags: ui.V2
            });
        }

        if (!objetivo.isCommunicationDisabled()) {
            return interaction.editReply({
                components: [ui.info(emojis, 'Ese usuario no esta silenciado.')],
                flags: ui.V2
            });
        }

        const rechazo = permisos.puedeActuarSobre(interaction.member, objetivo, interaction.guild.members.me);
        if (rechazo) {
            return interaction.editReply({ components: [ui.error(emojis, rechazo)], flags: ui.V2 });
        }

        try {
            await objetivo.timeout(null, `${motivo} · por ${interaction.user.tag}`);
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No he podido retirarlo: ${error.message}`)],
                flags: ui.V2
            });
        }

        await client.sistemas.log?.sancion({
            accion: 'Silencio retirado',
            emoji: 'callconnect',
            objetivo: usuario,
            moderador: interaction.user,
            motivo
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `<@${usuario.id}> puede volver a hablar.\n-# ${ui.plano(motivo)}`)],
            flags: ui.V2
        });
    }
};
