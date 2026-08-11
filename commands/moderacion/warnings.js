'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Show a member warning history')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o =>
            o.setName('user').setDescription('Member to inspect').setRequired(true))
        .addBooleanOption(o =>
            o.setName('include_removed').setDescription('Include warnings that were already removed')),

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const usuario = interaction.options.getUser('user');
        const incluirRetirados = interaction.options.getBoolean('include_removed') ?? false;
        await interaction.editReply(
            await client.sistemas.mod.panelAvisos(usuario.id, 0, incluirRetirados)
        );
    }
};
