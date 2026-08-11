'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function average(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function percentile(values, value = 0.5) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))];
}

function countBy(tickets, selector) {
    const result = {};
    for (const ticket of tickets) {
        const key = selector(ticket);
        result[key] = (result[key] ?? 0) + 1;
    }
    return result;
}

function linesFromCounts(counts, formatter = key => key, limit = 8) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, total]) => `- **${formatter(key)}:** ${total}`)
        .join('\n') || '- Sin datos';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-stats')
        .setDescription('Show detailed support performance, workload and service quality metrics')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, { client, emojis, ui }) {
        const system = client.sistemas.ticket;
        const db = system.db.data;
        const active = Object.values(db.activos);
        const closed = Object.values(db.archivados);
        const all = [...active, ...closed];
        const ratings = db.valoraciones ?? [];
        const now = Date.now();
        const day = 86400000;
        const resolutions = closed.filter(ticket => ticket.cerradoEn && ticket.abiertoEn).map(ticket => ticket.cerradoEn - ticket.abiertoEn);
        const firstClaims = all.filter(ticket => ticket.reclamadoEn && ticket.abiertoEn).map(ticket => ticket.reclamadoEn - ticket.abiertoEn);
        const closed7 = closed.filter(ticket => ticket.cerradoEn >= now - 7 * day);
        const opened7 = all.filter(ticket => ticket.abiertoEn >= now - 7 * day);
        const closed30 = closed.filter(ticket => ticket.cerradoEn >= now - 30 * day);
        const opened30 = all.filter(ticket => ticket.abiertoEn >= now - 30 * day);
        const backlogAge = active.map(ticket => now - ticket.abiertoEn);
        const unclaimed = active.filter(ticket => !ticket.reclamadoPor);
        const stale = active.filter(ticket => now - (ticket.ultimaActividad ?? ticket.abiertoEn) >= day);
        const notifications = all.reduce((total, ticket) => total + (ticket.notificaciones?.length ?? 0), 0);
        const notes = all.reduce((total, ticket) => total + (ticket.notas?.length ?? 0), 0);

        const categoryNames = system.config.categorias;
        const categories = linesFromCounts(countBy(all, ticket => ticket.categoria), key => categoryNames[key]?.nombre ?? key);
        const priorities = linesFromCounts(countBy(active, ticket => String(ticket.prioridad)), key => system.config.prioridades[key]?.nombre ?? key);
        const ratingCounts = countBy(ratings, rating => String(rating.estrellas));
        const ratingLine = [5, 4, 3, 2, 1].map(stars => `**${stars}★** ${ratingCounts[stars] ?? 0}`).join(' · ');
        const averageRating = average(ratings.map(rating => rating.estrellas));

        const staff = {};
        for (const ticket of active) {
            if (!ticket.reclamadoPor) continue;
            (staff[ticket.reclamadoPor] ??= { active: 0, closed: 0, claimTimes: [] }).active++;
        }
        for (const ticket of closed) {
            if (!ticket.reclamadoPor) continue;
            const entry = (staff[ticket.reclamadoPor] ??= { active: 0, closed: 0, claimTimes: [] });
            entry.closed++;
            if (ticket.reclamadoEn && ticket.abiertoEn) entry.claimTimes.push(ticket.reclamadoEn - ticket.abiertoEn);
        }
        const staffLines = Object.entries(staff)
            .sort((a, b) => (b[1].closed + b[1].active) - (a[1].closed + a[1].active))
            .slice(0, 8)
            .map(([id, data], index) =>
                `${index + 1}. <@${id}> · **${data.active} activos** · ${data.closed} cerrados` +
                (data.claimTimes.length ? ` · respuesta media ${ui.duracion(average(data.claimTimes))}` : '')
            ).join('\n') || '- Aún no hay actividad atribuida al equipo';

        const body = [
            ui.campos(emojis, [
                { emoji: 'ticketAbierto', etiqueta: 'Backlog activo', valor: `**${active.length}** · ${unclaimed.length} sin reclamar · ${stale.length} sin actividad 24 h` },
                { emoji: 'transcripcion', etiqueta: 'Histórico cerrado', valor: `**${closed.length}** · ${closed7.length} últimos 7 d · ${closed30.length} últimos 30 d` },
                { emoji: 'reloj', etiqueta: 'Primera atención', valor: firstClaims.length ? `media ${ui.duracion(average(firstClaims))} · mediana ${ui.duracion(percentile(firstClaims))}` : 'Sin datos' },
                { emoji: 'estadisticas', etiqueta: 'Resolución', valor: resolutions.length ? `media ${ui.duracion(average(resolutions))} · mediana ${ui.duracion(percentile(resolutions))} · P90 ${ui.duracion(percentile(resolutions, 0.9))}` : 'Sin datos' },
                { emoji: 'valoracion', etiqueta: 'Satisfacción', valor: ratings.length ? `**${averageRating.toFixed(2)}/5** · ${ratings.length} respuestas` : 'Sin valoraciones' },
                { emoji: 'notificacion', etiqueta: 'Seguimiento interno', valor: `${notifications} recordatorios enviados · ${notes} notas internas` }
            ]),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('estadisticas')} Flujo de trabajo\n` +
                `- **Últimos 7 días:** ${opened7.length} abiertos · ${closed7.length} resueltos · balance ${closed7.length - opened7.length >= 0 ? '+' : ''}${closed7.length - opened7.length}\n` +
                `- **Últimos 30 días:** ${opened30.length} abiertos · ${closed30.length} resueltos · tasa de resolución ${opened30.length ? Math.round((closed30.length / opened30.length) * 100) : 0}%\n` +
                `- **Antigüedad del backlog:** ${backlogAge.length ? `media ${ui.duracion(average(backlogAge))} · más antiguo ${ui.duracion(Math.max(...backlogAge))}` : 'sin tickets activos'}`
            ),
            ui.linea(),
            ui.texto(`### ${emojis.rol('prioridadMedia')} Prioridad activa\n${priorities}`),
            ui.texto(`### ${emojis.rol('catalogo')} Actividad por categoría\n${categories}`),
            ui.linea(),
            ui.texto(`### ${emojis.rol('reclamar')} Carga y rendimiento del equipo\n${staffLines}`),
            ui.linea(),
            ui.texto(`### ${emojis.rol('valoracion')} Distribución de valoraciones\n${ratingLine}`)
        ];

        return interaction.reply({
            components: [ui.panel(emojis, {
                emoji: 'estadisticas',
                titulo: 'Inteligencia de soporte',
                subtitulo: 'Rendimiento, carga operativa, tiempos de servicio y satisfacción.',
                cuerpo: body,
                pie: `Actualizado ${ui.fecha(now, 'R')} · ${all.length} casos analizados`
            })],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }
};
