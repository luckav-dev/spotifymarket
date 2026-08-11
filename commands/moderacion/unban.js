'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Remove a user ban')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addStringOption(o =>
            o.setName('user_id').setDescription('ID of the banned user').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason for removing the ban').setMaxLength(400)),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getString('user_id').trim();
        const motivo = interaction.options.getString('reason') ?? 'Sin motivo indicado';

        if (!/^\d{17,20}$/.test(id)) {
            return interaction.editReply({
                components: [ui.error(emojis, 'El ID tiene que contener entre 17 y 20 digitos.')],
                flags: ui.V2
            });
        }

        // El usuario no esta en el servidor, asi que no hay member al que
        // resolver: se trabaja con el ID y se comprueba contra la lista de baneos.
        const baneo = await interaction.guild.bans.fetch(id).catch(() => null);
        if (!baneo) {
            return interaction.editReply({
                components: [ui.error(emojis, 'Ese ID no corresponde a ningun usuario baneado.')],
                flags: ui.V2
            });
        }

        try {
            await interaction.guild.bans.remove(id, `${motivo} · por ${interaction.user.tag}`);
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No he podido desbanearlo: ${error.message}`)],
                flags: ui.V2
            });
        }

        await client.sistemas.log?.sancion({
            accion: 'Baneo retirado',
            emoji: 'reply',
            objetivo: baneo.user,
            moderador: interaction.user,
            motivo
        });

        await interaction.editReply({
            components: [ui.exito(emojis, `Baneo retirado a \`${baneo.user.tag}\`.\n-# ${motivo}`)],
            flags: ui.V2
        });
    }
};
