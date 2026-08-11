'use strict';

const { SlashCommandBuilder } = require('discord.js');

const GRUPOS = [
    {
        titulo: 'Administracion',
        emoji: 'administrador',
        comandos: ['publish', 'product', 'emojis', 'say', 'setup', 'diagnostics', 'ticket-stats']
    },
    {
        titulo: 'Moderacion',
        emoji: 'moderacion',
        comandos: ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn', 'warnings', 'remove-warning', 'clear', 'channel']
    },
    {
        titulo: 'Informacion',
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
                titulo: 'Centro de ayuda',
                subtitulo: 'Herramientas disponibles en el servidor.',
                cuerpo: [
                    ...secciones,
                    ui.texto(`### ${emojis.rol('ticket')} Gestión de tickets\nLas acciones de cada caso se realizan desde **Claim**, **Admin menu** y **Close** dentro del propio ticket; no existen comandos de gestión duplicados.`)
                ],
                pie: 'Discord solo muestra y permite ejecutar los comandos para los que tienes permisos.'
            })],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }
};
