'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Manage security and message rate in the current channel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(sub => sub
            .setName('lock')
            .setDescription('Temporarily prevent members from sending messages')
            .addStringOption(o => o.setName('reason').setDescription('Reason for locking the channel').setMaxLength(300)))
        .addSubcommand(sub => sub
            .setName('unlock')
            .setDescription('Restore inherited message permissions')
            .addStringOption(o => o.setName('reason').setDescription('Reason for unlocking the channel').setMaxLength(300)))
        .addSubcommand(sub => sub
            .setName('slowmode')
            .setDescription('Set slowmode; use 0 to disable it')
            .addIntegerOption(o => o
                .setName('seconds')
                .setDescription('Value between 0 and 21600 seconds')
                .setMinValue(0)
                .setMaxValue(21600)
                .setRequired(true)))
        .addSubcommand(sub => sub.setName('info').setDescription('Show the current channel settings')),

    async execute(interaction, { client, emojis, ui }) {
        const canal = interaction.channel;
        if (!canal?.isTextBased?.() || !canal.permissionOverwrites) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Este tipo de canal no admite esa gestion.'));
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'info') {
            const overwrite = canal.permissionOverwrites.cache.get(interaction.guildId);
            const bloqueado = overwrite?.deny?.has(PermissionFlagsBits.SendMessages) ?? false;
            return interaction.reply({
                components: [ui.panel(emojis, {
                    emoji: 'canal',
                    titulo: `Estado de #${canal.name}`,
                    cuerpo: [ui.campos(emojis, [
                        { emoji: 'conexion', etiqueta: 'Escritura general', valor: bloqueado ? 'Bloqueada' : 'Permitida o heredada' },
                        { emoji: 'reloj', etiqueta: 'Modo lento', valor: canal.rateLimitPerUser ? `${canal.rateLimitPerUser} segundos` : 'Desactivado' },
                        { emoji: 'info', etiqueta: 'NSFW', valor: canal.nsfw ? 'Si' : 'No' },
                        { emoji: 'cuenta', etiqueta: 'Creado', valor: ui.fecha(canal.createdTimestamp, 'F') },
                        { emoji: 'perfil', etiqueta: 'ID', valor: ui.dato(canal.id) }
                    ])]
                })],
                flags: ui.V2_EFIMERO,
                allowedMentions: { parse: [] }
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (sub === 'slowmode') {
            const segundos = interaction.options.getInteger('seconds');
            await canal.setRateLimitPerUser(segundos, `Ajustado por ${interaction.user.tag}`);
            await client.sistemas.log?.enviar('canales',
                `## ${emojis.rol('reloj')} Modo lento actualizado\n\n` +
                `${emojis.rol('canal')} **Canal:** <#${canal.id}>\n` +
                `${emojis.rol('moderacion')} **Por:** <@${interaction.user.id}>\n` +
                `${emojis.rol('ajustes')} **Valor:** ${segundos ? `${segundos} segundos` : 'Desactivado'}\n\n` +
                `-# ${ui.fecha(Date.now(), 'F')}`);
            return interaction.editReply({
                components: [ui.exito(emojis, segundos ? `Modo lento configurado en **${segundos} segundos**.` : 'Modo lento desactivado.')],
                flags: ui.V2
            });
        }

        const bloquear = sub === 'lock';
        const motivo = interaction.options.getString('reason') ?? (bloquear ? 'Bloqueo temporal' : 'Canal reabierto');
        await canal.permissionOverwrites.edit(interaction.guildId, {
            SendMessages: bloquear ? false : null,
            AddReactions: bloquear ? false : null,
            SendMessagesInThreads: bloquear ? false : null
        }, { reason: `${motivo} · por ${interaction.user.tag}` });

        await client.sistemas.log?.enviar('canales',
            `## ${emojis.rol(bloquear ? 'cerrar' : 'exito')} Canal ${bloquear ? 'bloqueado' : 'desbloqueado'}\n\n` +
            `${emojis.rol('canal')} **Canal:** <#${canal.id}>\n` +
            `${emojis.rol('moderacion')} **Por:** <@${interaction.user.id}>\n` +
            `${emojis.rol('motivo')} **Motivo:** ${ui.plano(motivo)}\n\n` +
            `-# ${ui.fecha(Date.now(), 'F')}`);

        return interaction.editReply({
            components: [ui.exito(emojis, `Canal ${bloquear ? 'bloqueado' : 'desbloqueado'} correctamente.\n-# ${ui.plano(motivo)}`)],
            flags: ui.V2
        });
    }
};
