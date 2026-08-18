'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ui = require('../../utils/ui');
const permisos = require('../../utils/permisos');

const UNIDADES = { m: 60000, h: 3600000, d: 86400000 };

/** Acepta "30m", "2h", "1d". Devuelve 0 si no hay duracion. */
function duracionMs(texto) {
    if (!texto) return 0;
    const partes = String(texto).trim().toLowerCase().match(/^(\d+)\s*([mhd])$/);
    if (!partes) return NaN;
    return Number(partes[1]) * UNIDADES[partes[2]];
}

module.exports = {
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Pause purchases and new tickets while you work on the service')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('on')
            .setDescription('Enable maintenance mode')
            .addStringOption(o => o
                .setName('reason')
                .setDescription('Short public explanation shown to members')
                .setMaxLength(400))
            .addStringOption(o => o
                .setName('duration')
                .setDescription('Automatic end, for example 30m, 2h or 1d')
                .setMaxLength(10)))
        .addSubcommand(sub => sub
            .setName('off')
            .setDescription('Disable maintenance mode'))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Show the current maintenance state')),

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.mant;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'El sistema de mantenimiento no está disponible.'));
        }
        if (permisos.nivelDe(interaction.member) < 5) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Necesitas nivel de administrador para usar este comando.'));
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
            const estado = sistema.db.data;
            return ui.responderEfimero(interaction, ui.panel(emojis, {
                emoji: 'mantenimiento',
                titulo: 'Estado del mantenimiento',
                cuerpo: [ui.campos(emojis, [
                    { emoji: sistema.activo() ? 'aviso' : 'exito', etiqueta: 'Estado', valor: sistema.activo() ? 'ACTIVO' : 'operativo normal' },
                    estado.activadoPor ? { emoji: 'usuario', etiqueta: 'Activado por', valor: `<@${estado.activadoPor}>` } : null,
                    estado.activadoEn ? { emoji: 'reloj', etiqueta: 'Desde', valor: ui.fecha(estado.activadoEn, 'f') } : null,
                    estado.hasta ? { emoji: 'programado', etiqueta: 'Termina', valor: ui.fecha(estado.hasta, 'R') } : null,
                    estado.motivo ? { emoji: 'motivo', etiqueta: 'Motivo', valor: ui.plano(estado.motivo) } : null
                ].filter(Boolean))],
                pie: `El staff de nivel ${sistema.config.excepciones?.nivelMinimoStaff ?? 3} o superior no se ve afectado.`
            }));
        }

        if (sub === 'off') {
            const estaba = await sistema.desactivar(interaction.user);
            return ui.responderEfimero(interaction, estaba
                ? ui.exito(emojis, 'Mantenimiento desactivado. Las compras y los tickets vuelven a estar disponibles.')
                : ui.info(emojis, 'El mantenimiento ya estaba desactivado.'));
        }

        const duracion = duracionMs(interaction.options.getString('duration'));
        if (Number.isNaN(duracion)) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                'Formato de duración no válido. Usa por ejemplo `30m`, `2h` o `1d`.'));
        }

        const motivo = interaction.options.getString('reason') ?? '';
        await sistema.activar(interaction.user, motivo, duracion);

        return ui.responderEfimero(interaction, ui.panel(emojis, {
            emoji: 'mantenimiento',
            titulo: 'Mantenimiento activado',
            cuerpo: [
                'Las compras y la apertura de tickets quedan pausadas para los clientes.',
                ui.campos(emojis, [
                    duracion ? { emoji: 'programado', etiqueta: 'Termina solo', valor: ui.fecha(Date.now() + duracion, 'R') } : null,
                    motivo ? { emoji: 'motivo', etiqueta: 'Motivo público', valor: ui.plano(motivo) } : null
                ].filter(Boolean))
            ],
            pie: 'Desactívalo con /maintenance off cuando termines.'
        }));
    }
};
