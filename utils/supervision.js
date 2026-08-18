'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('./logger');

/**
 * Memoria de arranques entre reinicios.
 *
 * El watchdog y los fallos fatales salen con codigo 1 para que el supervisor
 * levante el proceso otra vez. Eso resuelve el fallo transitorio, pero
 * convierte el permanente (un config roto, un permiso que falta) en un bucle:
 * arranca, falla, reinicia, falla. Contando los fallos consecutivos en disco se
 * puede frenar el bucle y avisar, en vez de reintentar cada pocos segundos para
 * siempre.
 */

const DIR = path.resolve(__dirname, '..', 'database');
const RUTA = path.join(DIR, 'supervision.json');

/** Si el proceso vivio mas que esto, el arranque cuenta como bueno. */
const ARRANQUE_ESTABLE_MS = 5 * 60 * 1000;
const ESPERA_MAX_MS = 5 * 60 * 1000;
const ESPERA_BASE_MS = 5000;

const VACIO = { fallosConsecutivos: 0, ultimoFallo: 0, ultimoMotivo: '', ultimoArranque: 0 };

function leer() {
    try {
        return { ...VACIO, ...JSON.parse(fs.readFileSync(RUTA, 'utf8')) };
    } catch {
        return { ...VACIO };
    }
}

function escribir(estado) {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const tmp = `${RUTA}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf8');
        fs.renameSync(tmp, RUTA);
    } catch (error) {
        logger.warn('supervision', `No se pudo guardar el estado de arranque: ${error.message}`);
    }
}

/**
 * Espera antes de dejar que el supervisor reintente. Crece exponencialmente
 * con los fallos consecutivos y se corta a los 5 minutos: un bucle rapido
 * quema la cuota de la API de Discord y llena el disco de logs.
 */
function esperaDeReinicio(fallos) {
    if (fallos <= 1) return 0;
    return Math.min(ESPERA_BASE_MS * (2 ** (fallos - 2)), ESPERA_MAX_MS);
}

/** Se llama al empezar. Devuelve el historial para decidir como arrancar. */
function abrirArranque() {
    const estado = leer();
    estado.ultimoArranque = Date.now();
    escribir(estado);
    return estado;
}

/** El bot llego a operativo: se olvida el historial de fallos. */
function arranqueCorrecto() {
    const estado = leer();
    if (!estado.fallosConsecutivos) return estado;

    const previos = estado.fallosConsecutivos;
    escribir({ ...VACIO, ultimoArranque: estado.ultimoArranque });
    logger.ok('supervision', `Arranque correcto tras ${previos} fallo(s) consecutivo(s).`);
    return { ...VACIO, recuperadoDe: previos };
}

/**
 * El proceso se va a morir. Devuelve cuantos fallos seguidos lleva y cuanto
 * conviene esperar antes de que el supervisor lo intente de nuevo.
 */
function arranqueFallido(motivo) {
    const estado = leer();
    const vivio = estado.ultimoArranque ? Date.now() - estado.ultimoArranque : 0;

    // Si el proceso aguanto en pie un buen rato, esto no es un bucle de
    // arranque: es una caida despues de haber funcionado. No debe penalizarse.
    const fallos = vivio > ARRANQUE_ESTABLE_MS ? 1 : estado.fallosConsecutivos + 1;

    escribir({
        fallosConsecutivos: fallos,
        ultimoFallo: Date.now(),
        ultimoMotivo: String(motivo).slice(0, 300),
        ultimoArranque: estado.ultimoArranque
    });

    return { fallos, esperaMs: esperaDeReinicio(fallos), vivioMs: vivio };
}

module.exports = { abrirArranque, arranqueCorrecto, arranqueFallido, esperaDeReinicio, ARRANQUE_ESTABLE_MS };
