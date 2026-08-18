'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const ui = require('../../utils/ui');

const SERVICES = [
    ['website', 'Website'],
    ['products', 'Product Catalog'],
    ['bot', 'Discord Bot'],
    ['tickets', 'Ticket System'],
    ['vouches', 'Vouch System'],
    ['paypal', 'PayPal'],
    ['bitcoin', 'Bitcoin (BTC)'],
    ['litecoin', 'Litecoin (LTC)']
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-status')
        .setDescription('Configure the live Spotify Market service status')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand => subcommand
            .setName('set')
            .setDescription('Change one service between automatic checks and maintenance')
            .addStringOption(option => option
                .setName('service')
                .setDescription('Service or payment method to configure')
                .setRequired(true)
                .addChoices(...SERVICES.map(([value, name]) => ({ name, value }))))
            .addStringOption(option => option
                .setName('mode')
                .setDescription('Automatic health checks or manual maintenance mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Automatic', value: 'automatic' },
                    { name: 'Maintenance', value: 'maintenance' }
                ))
            .addStringOption(option => option
                .setName('note')
                .setDescription('Optional public maintenance note')
                .setMaxLength(180)
                .setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('view')
            .setDescription('View all current status overrides'))
        .addSubcommand(subcommand => subcommand
            .setName('refresh')
            .setDescription('Run fresh checks and update every published status panel'))
        .addSubcommand(subcommand => subcommand
            .setName('reset')
            .setDescription('Return every service to automatic health checks')),

    async execute(interaction, { client, emojis }) {
        const system = client.sistemas?.status;
        if (!system?.isEnabled?.()) {
            return interaction.reply({
                components: [ui.aviso(emojis, 'The service status system is currently disabled.')],
                flags: ui.V2_EFIMERO
            });
        }

        const action = interaction.options.getSubcommand();

        if (action === 'view') {
            return interaction.reply({
                components: [system.construirConfigPanel()],
                flags: ui.V2_EFIMERO
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (action === 'refresh') {
            const updated = await system.refrescarPaneles({ force: true });
            return interaction.editReply({
                components: [ui.exito(
                    emojis,
                    `Fresh health checks completed. **${updated}** published status panel${updated === 1 ? '' : 's'} updated.`
                )],
                flags: ui.V2
            });
        }

        if (action === 'reset') {
            await system.resetOverrides(interaction.user.id);
            return interaction.editReply({
                components: [ui.exito(
                    emojis,
                    'All services now use **automatic health checks**. Any manual maintenance overrides were cleared.'
                )],
                flags: ui.V2
            });
        }

        if (action === 'set') {
            const service = interaction.options.getString('service', true);
            const mode = interaction.options.getString('mode', true);
            const note = interaction.options.getString('note') || '';
            const definition = await system.setOverride(service, mode, interaction.user.id, note);

            if (!definition) {
                return interaction.editReply({
                    components: [ui.error(emojis, 'That service or status mode is not available.')],
                    flags: ui.V2
                });
            }

            const label = mode === 'maintenance' ? 'MAINTENANCE' : 'AUTOMATIC';
            const suffix = mode === 'maintenance' && note.trim()
                ? `\n> ${ui.plano(note.trim())}`
                : '';

            return interaction.editReply({
                components: [ui.exito(
                    emojis,
                    `**${definition.label}** is now set to \`${label}\`.${suffix}\n-# Every published status panel has been refreshed.`
                )],
                flags: ui.V2
            });
        }

        return interaction.editReply({
            components: [ui.error(emojis, 'Unknown status configuration action.')],
            flags: ui.V2
        });
    }
};
