'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ui = require('../../utils/ui');
const permisos = require('../../utils/permisos');

const POR_PAGINA = 5;

/**
 * Consulta del historico de tickets.
 *
 * Los tickets cerrados ya se guardaban, pero no habia forma de mirarlos sin
 * abrir la base de datos a mano: /ticket-stats da agregados, no casos. Esto es
 * la vista de caso concreto que necesita el staff cuando un cliente vuelve.
 *
 * Solo lo ve el equipo, asi que la interfaz va en espanol.
 */

function coincide(ticket, { usuario, texto, categoria }) {
    if (usuario && ticket.userId !== usuario) return false;
    if (categoria && ticket.categoria !== categoria) return false;
    if (!texto) return true;

    const aguja = texto.toLowerCase();
    const campos = [
        String(ticket.id),
        ticket.categoria,
        ticket.motivoCierre ?? '',
        ticket.nombreCanal ?? '',
        ...Object.values(ticket.respuestas ?? {}),
        ...(ticket.notas ?? []).map(nota => nota.contenido)
    ];

    return campos.some(campo => String(campo).toLowerCase().includes(aguja));
}

function resumen(emojis, sistema, ticket) {
    const estrellas = ticket.valoracion
        ? `${'★'.repeat(ticket.valoracion.estrellas)}${'☆'.repeat(5 - ticket.valoracion.estrellas)}`
        : 'sin valorar';
    const duracion = ticket.cerradoEn && ticket.abiertoEn
        ? ui.duracion(ticket.cerradoEn - ticket.abiertoEn)
        : 'en curso';

    return [
        `**#${sistema.numeroFmt(ticket.id)}** · ${ticket.estado === 'abierto' ? 'abierto' : 'cerrado'} · ${ticket.categoria}`,
        `${emojis.get('user')} <@${ticket.userId}> · ${emojis.get('clock')} ${ui.fecha(ticket.abiertoEn, 'D')} · duración ${duracion}`,
        ticket.reclamadoPor ? `${emojis.get('guardian')} Atendido por <@${ticket.reclamadoPor}>` : null,
        ticket.motivoCierre ? `${emojis.get('motivo')} ${ui.plano(ui.truncar(ticket.motivoCierre, 160))}` : null,
        `${emojis.get('estrellita')} ${estrellas}${ticket.estado === 'abierto' ? ` · <#${ticket.canalId}>` : ''}`
    ].filter(Boolean).join('\n');
}

module.exports = {
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('ticket-history')
        .setDescription('Search open and archived tickets by member, text or category')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addUserOption(o => o
            .setName('member')
            .setDescription('Only tickets opened by this member'))
        .addStringOption(o => o
            .setName('text')
            .setDescription('Free text searched in answers, notes, closing reason and case number')
            .setMaxLength(100))
        .addStringOption(o => o
            .setName('category')
            .setDescription('Only tickets from this category')
            .setAutocomplete(true))
        .addIntegerOption(o => o
            .setName('page')
            .setDescription('Result page')
            .setMinValue(1)),

    async autocomplete(interaction, { client }) {
        const categorias = Object.entries(client.config.cargar('tickets').categorias ?? {});
        const escrito = interaction.options.getFocused().toLowerCase();

        return interaction.respond(
            categorias
                .filter(([clave, cat]) => clave.includes(escrito) || cat.nombre.toLowerCase().includes(escrito))
                .slice(0, 25)
                .map(([clave, cat]) => ({ name: cat.nombre, value: clave }))
        );
    },

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.ticket;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'El sistema de tickets no está disponible.'));
        }
        if (!permisos.puede(interaction.member, 'menuAdmin')) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'No tienes permiso para consultar el histórico.'));
        }

        const filtros = {
            usuario: interaction.options.getUser('member')?.id ?? null,
            texto: interaction.options.getString('text')?.trim() ?? null,
            categoria: interaction.options.getString('category') ?? null
        };

        const datos = sistema.db.data;
        const todos = [...Object.values(datos.activos), ...Object.values(datos.archivados)]
            .filter(ticket => coincide(ticket, filtros))
            .sort((a, b) => (b.cerradoEn ?? b.abiertoEn) - (a.cerradoEn ?? a.abiertoEn));

        if (!todos.length) {
            return ui.responderEfimero(interaction, ui.info(emojis,
                'Ningún ticket coincide con esa búsqueda.\n-# El histórico podado vive en `database/historico/`.'));
        }

        const totalPaginas = Math.ceil(todos.length / POR_PAGINA);
        const pagina = Math.min(Math.max((interaction.options.getInteger('page') ?? 1) - 1, 0), totalPaginas - 1);
        const visibles = todos.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);

        const descripcion = [
            filtros.usuario ? `cliente <@${filtros.usuario}>` : null,
            filtros.categoria ? `categoría \`${filtros.categoria}\`` : null,
            filtros.texto ? `texto «${ui.plano(filtros.texto)}»` : null
        ].filter(Boolean).join(' · ') || 'todos los tickets';

        const abiertos = todos.filter(t => t.estado === 'abierto').length;
        const valorados = todos.filter(t => t.valoracion);
        const media = valorados.length
            ? (valorados.reduce((n, t) => n + t.valoracion.estrellas, 0) / valorados.length).toFixed(2)
            : '—';

        return ui.responderEfimero(interaction, ui.panel(emojis, {
            emoji: 'historial',
            titulo: 'Histórico de tickets',
            subtitulo: `${todos.length} resultado(s) · ${descripcion}`,
            cuerpo: [
                ui.campos(emojis, [
                    { emoji: 'ticketAbierto', etiqueta: 'Abiertos ahora', valor: String(abiertos), codigo: true },
                    { emoji: 'cerrar', etiqueta: 'Cerrados', valor: String(todos.length - abiertos), codigo: true },
                    { emoji: 'valoracion', etiqueta: 'Valoración media', valor: String(media), codigo: true }
                ]),
                ui.linea(),
                visibles.map(ticket => resumen(emojis, sistema, ticket)).join('\n\n')
            ],
            pie: `Página ${pagina + 1} de ${totalPaginas}${totalPaginas > 1 ? ' · usa la opción page para avanzar' : ''}`
        }));
    }
};
