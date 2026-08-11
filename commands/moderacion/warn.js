'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const permisos = require('../../utils/permisos');
const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Add a warning to a member history')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member to warn').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(400)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const objetivo = interaction.options.getMember('user');
        const usuario = interaction.options.getUser('user');
        const motivo = interaction.options.getString('reason');
        const mod = client.sistemas.mod;

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

        mod.anadirAviso(usuario.id, motivo, interaction.user.id);
        const activos = mod.avisosDe(usuario.id).length;

        await mod.notificar(usuario, {
            titulo: 'Has recibido un aviso',
            emoji: 'aviso',
            guild: interaction.guild,
            motivo,
            extra: { etiqueta: 'Avisos activos', valor: String(activos) }
        });

        await client.sistemas.log?.sancion({
            accion: 'Aviso registrado',
            emoji: 'aviso',
            objetivo: usuario,
            moderador: interaction.user,
            motivo,
            extra: { etiqueta: 'Avisos activos', valor: String(activos) }
        });

        // El escalado se aplica despues de notificar, para que el usuario reciba
        // el aviso aunque la sancion automatica lo expulse a continuacion.
        const sancion = await mod.aplicarEscalado(objetivo, activos);

        const texto = sancion
            ? `Aviso registrado contra <@${usuario.id}>. Van ${activos}.\n-# Se ha aplicado ${sancion.accion} por acumulacion.`
            : `Aviso registrado contra <@${usuario.id}>. Van ${activos}.`;

        await interaction.editReply({ components: [ui.exito(emojis, texto)], flags: ui.V2 });
    }
};
