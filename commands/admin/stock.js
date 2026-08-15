'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const config = require('../../utils/config');
const ui = require('../../utils/ui');
const stockArte = require('../../utils/sellAuthStockArtwork');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('Configure or refresh the automatic SellAuth stock board')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => option
            .setName('action')
            .setDescription('Stock board action')
            .setRequired(true)
            .addChoices(
                { name: 'Set stock channel', value: 'set' },
                { name: 'Refresh now', value: 'refresh' },
                { name: 'View status', value: 'status' }
            ))
        .addChannelOption(option => option
            .setName('channel')
            .setDescription('Channel that will contain the persistent stock board')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

    cooldown: 3,

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const sistema = client.sistemas?.sellauth;
        const accion = interaction.options.getString('action');
        const canal = interaction.options.getChannel('channel');

        if (!sistema) {
            return interaction.editReply({ components: [ui.error(emojis, 'SellAuth system is not available.')], flags: ui.V2 });
        }

        if (accion === 'set') {
            if (!canal) {
                return interaction.editReply({
                    components: [ui.aviso(emojis, 'Choose the channel that should contain the stock board.')],
                    flags: ui.V2
                });
            }

            const ajustes = structuredClone(sistema.config);
            ajustes.channels ??= {};
            ajustes.stockPanel ??= {};
            ajustes.channels.stock = canal.id;
            ajustes.stockPanel.enabled = true;
            config.guardar('sellauth', ajustes);

            try {
                const mensaje = await sistema.actualizarPanelStock({ canal, forzar: true });
                return interaction.editReply({
                    components: [ui.exito(
                        emojis,
                        `Stock board configured in <#${canal.id}>.\n-# HTML/Chromium renderer active. The same message updates automatically after SellAuth stock changes.${mensaje?.url ? `\n[Open stock board](${mensaje.url})` : ''}`
                    )],
                    flags: ui.V2
                });
            } catch (error) {
                return interaction.editReply({
                    components: [ui.error(emojis, `The channel was saved, but the HTML board could not be published: ${ui.plano(error.message)}`)],
                    flags: ui.V2
                });
            }
        }

        if (accion === 'refresh') {
            try {
                await sistema.sincronizar({ anunciar: false });
                const mensaje = await sistema.actualizarPanelStock({ forzar: true });
                if (!mensaje) {
                    return interaction.editReply({
                        components: [ui.aviso(emojis, 'Configure a stock channel first with `/stock action:Set stock channel`.')],
                        flags: ui.V2
                    });
                }
                return interaction.editReply({
                    components: [ui.exito(emojis, `HTML stock board regenerated successfully.\n-# [Open stock board](${mensaje.url})`)],
                    flags: ui.V2
                });
            } catch (error) {
                return interaction.editReply({
                    components: [ui.error(emojis, `HTML stock refresh failed: ${ui.plano(error.message)}`)],
                    flags: ui.V2
                });
            }
        }

        const ajustes = sistema.config;
        const estado = sistema.stockDb?.data ?? {};
        const productos = sistema.productosConStock?.() ?? [];
        const canalId = ajustes.channels?.stock || estado.channelId;
        const ultima = estado.updatedAt ? ui.fecha(estado.updatedAt, 'R') : '`never`';
        const diagnostico = stockArte.diagnostico();

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${emojis.rol('stock')} Stock board status\n` +
                `> Persistent SellAuth inventory rendered from real HTML/CSS.`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${emojis.rol('canal')} **Channel:** ${canalId ? `<#${canalId}>` : '`not configured`'}\n` +
                `${emojis.rol('producto')} **Products in stock:** ${ui.dato(productos.length)}\n` +
                `${emojis.rol('files')} **Stock images:** ${ui.dato(estado.pageCount || 0)}\n` +
                `${emojis.rol('actualizar')} **Last image update:** ${ultima}\n` +
                `${emojis.rol(diagnostico.available ? 'exito' : 'error')} **Renderer:** ${ui.dato(diagnostico.renderer)}\n` +
                `${emojis.rol(diagnostico.available ? 'exito' : 'error')} **Chromium:** ${diagnostico.chromiumPath ? ui.dato(diagnostico.chromiumPath) : '`not found`'}\n` +
                `${emojis.rol(estado.lastError ? 'error' : 'exito')} **State:** ${estado.lastError ? ui.plano(estado.lastError) : 'Healthy'}`
            ));

        return interaction.editReply({ components: [container], flags: ui.V2 });
    }
};
