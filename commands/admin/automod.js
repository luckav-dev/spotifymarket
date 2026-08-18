'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ui = require('../../utils/ui');
const permisos = require('../../utils/permisos');

module.exports = {
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Inspect automatic moderation and lift a raid lockdown')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Show active filters, recent activity and raid state'))
        .addSubcommand(sub => sub
            .setName('raid-off')
            .setDescription('Lift the automatic raid lockdown right now'))
        .addSubcommand(sub => sub
            .setName('user')
            .setDescription('Show the automatic infractions recorded for a member')
            .addUserOption(o => o
                .setName('member')
                .setDescription('Member to inspect')
                .setRequired(true))),

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.automod;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'La auto-moderación no está disponible.'));
        }
        if (permisos.nivelDe(interaction.member) < 3) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Necesitas nivel de moderador para usar este comando.'));
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'raid-off') {
            const estaba = sistema.levantarBloqueo();
            return ui.responderEfimero(interaction, estaba
                ? ui.exito(emojis, 'Bloqueo antiraid levantado. Las entradas vuelven a tratarse con normalidad.')
                : ui.info(emojis, 'No había ningún bloqueo antiraid activo.'));
        }

        if (sub === 'user') {
            const usuario = interaction.options.getUser('member');
            const infracciones = sistema.db.data.infracciones[usuario.id] ?? [];

            if (!infracciones.length) {
                return ui.responderEfimero(interaction, ui.info(emojis,
                    `<@${usuario.id}> no tiene ninguna infracción automática registrada.`));
            }

            return ui.responderEfimero(interaction, ui.panel(emojis, {
                emoji: 'automod',
                titulo: 'Infracciones automáticas',
                subtitulo: `${infracciones.length} registro(s) de <@${usuario.id}>.`,
                cuerpo: [[...infracciones].reverse().slice(0, 15)
                    .map(i => `- \`${i.tipo}\` · ${ui.fecha(i.fecha, 'f')}`)
                    .join('\n')],
                pie: 'Solo se conservan los últimos 20 registros por usuario.'
            }));
        }

        const cfg = sistema.config;
        const stats = sistema.estadisticas();
        const activos = Object.entries(cfg.filtros ?? {})
            .filter(([, filtro]) => filtro.activo)
            .map(([nombre, filtro]) => `- \`${nombre}\` · acción: ${filtro.accion}`)
            .join('\n') || '- ningún filtro activo';

        const desglose = Object.entries(stats.porTipo)
            .sort((a, b) => b[1] - a[1])
            .map(([tipo, total]) => `\`${tipo}\` ${total}`)
            .join(' · ') || 'sin actividad';

        return ui.responderEfimero(interaction, ui.panel(emojis, {
            emoji: 'automod',
            titulo: 'Estado de la auto-moderación',
            subtitulo: cfg.activo ? 'Sistema activo.' : 'Sistema desactivado en config/automod.json.',
            cuerpo: [
                `### ${emojis.rol('ajustes')} Filtros\n${activos}`,
                ui.linea(),
                ui.campos(emojis, [
                    { emoji: 'estadisticas', etiqueta: 'Infracciones (24 h)', valor: String(stats.ultimas24h), codigo: true },
                    { emoji: 'miembros', etiqueta: 'Usuarios con historial', valor: String(stats.usuarios), codigo: true },
                    { emoji: 'antiraid', etiqueta: 'Antiraid', valor: stats.bloqueado ? 'BLOQUEO ACTIVO' : 'en vigilancia' },
                    { emoji: 'aviso', etiqueta: 'Oleadas detectadas', valor: String(stats.raids), codigo: true }
                ]),
                `-# Últimas 24 h por tipo: ${desglose}`,
                sistema.permisosSuficientes(interaction.guild)
                    ? null
                    : `${emojis.rol('error')} **Al bot le faltan permisos:** necesita Gestionar mensajes y Moderar miembros para que los filtros hagan algo.`
            ].filter(Boolean),
            pie: 'Los umbrales y las acciones se editan en config/automod.json.'
        }));
    }
};
