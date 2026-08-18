'use strict';

const logger = require('./logger');

/**
 * Avisos operativos fuera de banda.
 *
 * Deliberadamente NO usa el cliente de discord.js: la mayoria de las cosas que
 * merecen una alerta ocurren justo cuando el cliente no esta disponible (fallo
 * de arranque, gateway caido, apagado por el watchdog). Un webhook es una
 * llamada HTTP suelta que sigue funcionando con el bot muerto.
 *
 * Configuracion por entorno, no por config/: son secretos.
 *   ALERT_WEBHOOK_URL   webhook de Discord al canal privado de staff
 *   HEALTHCHECK_URL     ping periodico a un monitor externo (healthchecks.io)
 */

const VENTANA_ANTIRREPETICION_MS = 5 * 60 * 1000;
const MAX_POR_MINUTO = 5;
const TIMEOUT_MS = 5000;

const ultimoEnvio = new Map();
let ventanaRitmo = { desde: 0, enviados: 0 };

function webhook() {
    const url = process.env.ALERT_WEBHOOK_URL?.trim() ?? '';
    return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(url) ? url : '';
}

/** Evita que un fallo en bucle convierta el canal de alertas en spam. */
function permitido(clave) {
    const ahora = Date.now();

    if (ahora - ventanaRitmo.desde > 60_000) ventanaRitmo = { desde: ahora, enviados: 0 };
    if (ventanaRitmo.enviados >= MAX_POR_MINUTO) return false;

    const previo = ultimoEnvio.get(clave) ?? 0;
    if (ahora - previo < VENTANA_ANTIRREPETICION_MS) return false;

    ultimoEnvio.set(clave, ahora);
    ventanaRitmo.enviados += 1;
    return true;
}

async function publicar(nivel, ambito, mensaje, { forzar = false } = {}) {
    const url = webhook();
    if (!url) return false;
    if (!forzar && !permitido(`${nivel}:${ambito}`)) return false;

    const iconos = { critico: '🔴', aviso: '🟠', recuperado: '🟢' };
    const cuerpo = {
        username: 'Spotify Market · Operaciones',
        // Las alertas las lee el equipo, no los clientes: van en espanol.
        content: [
            `${iconos[nivel] ?? '⚪'} **${nivel.toUpperCase()}** · \`${ambito}\``,
            String(mensaje).slice(0, 1800),
            `-# ${new Date().toISOString()} · host \`${process.env.HOSTNAME || 'desconocido'}\` · pid ${process.pid}`
        ].join('\n'),
        allowed_mentions: { parse: [] }
    };

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    temporizador.unref?.();

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
            signal: controlador.signal
        });
        return true;
    } catch (error) {
        // Un fallo aqui no puede escalar: solo se deja constancia en consola.
        logger.warn('alertas', `No se pudo enviar la alerta: ${error.message}`);
        return false;
    } finally {
        clearTimeout(temporizador);
    }
}

/**
 * Version sincrona para usar en rutas de apagado, donde el proceso no va a
 * esperar a que se resuelva una promesa. Dispara y se olvida.
 */
function disparar(nivel, ambito, mensaje, opciones) {
    publicar(nivel, ambito, mensaje, opciones).catch(() => {});
}

/** Ping a un monitor externo. Su ausencia es la senal de que el bot murio. */
async function latido(estado = '') {
    const base = process.env.HEALTHCHECK_URL?.trim();
    if (!base || !/^https:\/\//i.test(base)) return false;

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    temporizador.unref?.();

    try {
        await fetch(estado ? `${base.replace(/\/+$/, '')}/${estado}` : base, {
            method: 'POST',
            signal: controlador.signal
        });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(temporizador);
    }
}

module.exports = {
    critico: (ambito, mensaje, opciones) => publicar('critico', ambito, mensaje, opciones),
    aviso: (ambito, mensaje, opciones) => publicar('aviso', ambito, mensaje, opciones),
    recuperado: (ambito, mensaje, opciones) => publicar('recuperado', ambito, mensaje, opciones),
    disparar,
    latido,
    configurado: () => Boolean(webhook())
};
