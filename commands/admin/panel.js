'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} = require('discord.js');

const ui = require('../../utils/ui');

const PANELES = [
    { value: 'tickets', name: 'Ticket support panel', system: 'ticket' },
    { value: 'verification', name: 'Verification panel', system: 'verify' },
    { value: 'catalog', name: 'Product catalog', system: 'shop' },
    { value: 'reviews', name: 'Verified reviews and review guide', system: 'sellauth' },
    { value: 'welcome-preview', name: 'Welcome preview', system: 'welcome' },
    { value: 'rules', name: 'Rules navigator', system: 'rules' },
    { value: 'service-status', name: 'Service status', system: 'status' },
    { value: 'suggestions', name: 'Suggestions panel', system: 'suggest' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('publish')
        .setDescription('Publish or update any bot panel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => option
            .setName('panel')
            .setDescription('Panel to publish')
            .setAutocomplete(true)
            .setRequired(true))
        .addChannelOption(option => option
            .setName('channel')
            .setDescription('Destination channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)),

    async autocomplete(interaction) {
        const query = interaction.options.getFocused().toLowerCase();
        return interaction.respond(
            PANELES
                .filter(item => item.name.toLowerCase().includes(query) || item.value.includes(query))
                .slice(0, 25)
                .map(item => ({ name: item.name, value: item.value }))
        );
    },

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('panel');
        const channel = interaction.options.getChannel('channel');
        const definition = PANELES.find(item => item.value === value);
        const system = definition ? client.sistemas?.[definition.system] : null;

        if (!definition || !system?.publicarPanel) {
            return interaction.editReply({
                components: [ui.error(emojis, 'The selected panel is not available.')],
                flags: ui.V2
            });
        }

        try {
            const extra = value === 'welcome-preview' ? interaction.member : undefined;
            const message = await system.publicarPanel(channel, extra);
            return interaction.editReply({
                components: [ui.exito(
                    emojis,
                    `**${definition.name}** publicado en <#${channel.id}>.\n-# [Abrir mensaje](${message.url}) · ID \`${message.id}\``
                )],
                flags: ui.V2
            });
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `No se pudo publicar el panel: ${error.message}`)],
                flags: ui.V2
            });
        }
    }
};
