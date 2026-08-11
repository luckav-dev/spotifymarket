'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const ui = require('../../utils/ui');

/** bulkDelete no puede borrar mensajes de mas de 14 dias. */
const LIMITE_EDAD_MS = 14 * 86400000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Delete recent messages from the current channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o =>
            o.setName('amount')
                .setDescription('Number of recent messages to inspect')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true))
        .addUserOption(o =>
            o.setName('user').setDescription('Only delete messages from this member')),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const cantidad = interaction.options.getInteger('amount');
        const usuario = interaction.options.getUser('user');

        const mensajes = await interaction.channel.messages.fetch({ limit: cantidad }).catch(() => null);
        if (!mensajes) {
            return interaction.editReply({
                components: [ui.error(emojis, 'No he podido leer los mensajes de este canal.')],
                flags: ui.V2
            });
        }

        const limite = Date.now() - LIMITE_EDAD_MS;
        const candidatos = mensajes.filter(m =>
            m.createdTimestamp > limite && (!usuario || m.author.id === usuario.id)
        );

        if (!candidatos.size) {
            return interaction.editReply({
                components: [ui.info(emojis, 'No hay mensajes que se puedan borrar: Discord no permite borrar en bloque los de mas de 14 dias.')],
                flags: ui.V2
            });
        }

        const borrados = await interaction.channel.bulkDelete(candidatos, true).catch(() => null);
        if (!borrados) {
            return interaction.editReply({
                components: [ui.error(emojis, 'No he podido borrarlos. Comprueba que tengo permiso para gestionar mensajes.')],
                flags: ui.V2
            });
        }

        const saltados = mensajes.size - borrados.size;

        await client.sistemas.log?.sancion({
            accion: 'Mensajes borrados',
            emoji: 'delete',
            objetivo: usuario ?? interaction.user,
            moderador: interaction.user,
            motivo: `${borrados.size} mensaje(s) en #${interaction.channel.name}`
        });

        await interaction.editReply({
            components: [ui.exito(emojis,
                `Borrados ${borrados.size} mensaje(s).` +
                (saltados ? `\n-# ${saltados} no se pudieron borrar por tener mas de 14 dias o no coincidir con el filtro.` : '')
            )],
            flags: ui.V2
        });
    }
};
