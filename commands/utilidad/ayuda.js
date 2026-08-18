'use strict';

const { SlashCommandBuilder } = require('discord.js');

const GRUPOS = [
    {
        titulo: 'Administration',
        emoji: 'administrador',
        comandos: ['publish', 'product', 'sellauth', 'stock', 'emojis', 'say', 'schedule', 'setup', 'diagnostics', 'maintenance']
    },
    {
        titulo: 'Moderation',
        emoji: 'moderacion',
        comandos: ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn', 'warnings', 'remove-warning', 'clear', 'channel', 'automod']
    },
    {
        titulo: 'Support',
        emoji: 'ticket',
        comandos: ['ticket-stats', 'ticket-history']
    },
    {
        titulo: 'Community',
        emoji: 'celebrar',
        comandos: ['giveaway', 'poll', 'suggest']
    },
    {
        titulo: 'Information',
        emoji: 'info',
        comandos: ['help', 'server-info', 'user-info', 'status']
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show every available bot system and command')
        .setDMPermission(false),

    async execute(interaction, { client, emojis, ui }) {
        const secciones = GRUPOS.map(grupo => {
            const comandos = grupo.comandos
                .map(nombre => client.commands.get(nombre))
                .filter(Boolean)
                .map(comando => `- **/${comando.data.name}** — ${comando.data.description}`)
                .join('\n');

            // Sin esta guarda, quitar un comando dejaba su cabecera suelta.
            if (!comandos) return null;
            return ui.texto(`### ${emojis.rol(grupo.emoji)} ${grupo.titulo}\n${comandos}`);
        }).filter(Boolean);

        return interaction.reply({
            components: [ui.panel(emojis, {
                emoji: 'comando',
                titulo: 'Help Center',
                subtitulo: 'Commands and systems available in this server.',
                cuerpo: [
                    ...secciones,
                    ui.texto(`### ${emojis.rol('ticket')} Ticket management\nEvery case is managed through **Claim**, **Admin menu** and **Close** inside its ticket; there are no duplicate management commands.`)
                ],
                pie: 'Discord only shows and allows commands for which you have permission.'
            })],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }
};
