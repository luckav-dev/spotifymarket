'use strict';

const { SlashCommandBuilder } = require('discord.js');

const GRUPOS = [
    {
        titulo: 'Administration',
        emoji: 'administrador',
        comandos: ['publish', 'product', 'emojis', 'say', 'setup', 'diagnostics', 'ticket-stats']
    },
    {
        titulo: 'Moderation',
        emoji: 'moderacion',
        comandos: ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn', 'warnings', 'remove-warning', 'clear', 'channel']
    },
    {
        titulo: 'Information',
        emoji: 'info',
        comandos: ['help', 'server-info', 'user-info', 'status', 'suggest']
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

            return ui.texto(`### ${emojis.rol(grupo.emoji)} ${grupo.titulo}\n${comandos}`);
        });

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
