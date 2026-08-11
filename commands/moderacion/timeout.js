'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const ModerationSystem = require('../../modules/moderationSystem');
const permisos = require('../../utils/permisos');
const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Temporarily timeout a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member to timeout').setRequired(true))
        .addStringOption(o =>
            o.setName('duration')
                .setDescription('Duration: 30m, 2h or 7d; maximum 28d')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for the timeout').setRequired(true).setMaxLength(400)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const objetivo = interaction.options.getMember('user');
        const usuario = interaction.options.getUser('user');
        const motivo = interaction.options.getString('reason');
        const duracionMs = ModerationSystem.parseDuracion(interaction.options.getString('duration'));

        if (!objetivo) {
            return interaction.editReply({
                components: [ui.error(emojis, 'Ese usuario no esta en el servidor.')],
                flags: ui.V2
            });
        }

        if (!duracionMs) {
            return interaction.editReply({
                components: [ui.error(emojis, 'Duracion invalida. Usa un numero y una unidad: `30m`, `2h`, `7d`. El maximo de Discord son 28 dias.')],
                flags: ui.V2
            });
        }

        const rechazo = permisos.puedeActuarSobre(interaction.member, objetivo, interaction.guild.members.me);
        if (rechazo) {
            return interaction.editReply({ components: [ui.error(emojis, rechazo)], flags: ui.V2 });
        }

        const hasta = Date.now() + duracionMs;

        await client.sistemas.mod.notificar(usuario, {
            titulo: 'You have been timed out',
            emoji: 'stagerequesttospeak',
            guild: interaction.guild,
            motivo,
            extra: { etiqueta: 'Until', valor: ui.fecha(hasta, 'F') }
        });

        try {
            await objetivo.timeout(duracionMs, `${motivo} · por ${interaction.user.tag}`);
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No he podido silenciarlo: ${error.message}`)],
                flags: ui.V2
            });
        }

        await client.sistemas.log?.sancion({
            accion: 'Usuario silenciado',
            emoji: 'stagerequesttospeak',
            objetivo: usuario,
            moderador: interaction.user,
            motivo,
            extra: { etiqueta: 'Hasta', valor: ui.fecha(hasta, 'F') }
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `<@${usuario.id}> silenciado hasta ${ui.fecha(hasta, 'F')}.\n-# ${motivo}`)],
            flags: ui.V2
        });
    }
};
