'use strict';

const { ActivityType } = require('discord.js');

const config = require('./config');

/** Aplica en Discord la presencia actual de config/bot.json. */
function aplicarPresencia(client) {
    const { presencia } = config.cargar('bot');
    if (!presencia || !client.user) return { aplicada: false, actividad: false };

    const nombre = presencia.actividad?.nombre?.trim();
    const estado = presencia.estado ?? 'online';

    if (!nombre) {
        client.user.setPresence({ status: estado, activities: [] });
        return { aplicada: true, actividad: false, estado };
    }

    const tipo = ActivityType[presencia.actividad?.tipo] ?? ActivityType.Custom;
    const actividad = tipo === ActivityType.Custom
        ? { name: 'custom', type: tipo, state: nombre }
        : { name: nombre, type: tipo };

    client.user.setPresence({ status: estado, activities: [actividad] });
    return { aplicada: true, actividad: true, estado, tipo: presencia.actividad?.tipo ?? 'Custom', nombre };
}

module.exports = { aplicarPresencia };
