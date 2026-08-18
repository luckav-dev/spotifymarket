'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('./logger');

const DIR = path.resolve(__dirname, '..', 'config');
const DIR_BACKUPS = path.join(DIR, 'backups');
const BACKUPS_A_CONSERVAR = 10;

/** @type {Map<string, object>} */
const cache = new Map();

/**
 * Carga config/<nombre>.json y lo cachea en memoria.
 *
 * Los archivos de config son la unica fuente de los textos e IDs del bot: nada
 * de valores incrustados en la logica. El dashboard reescribe estos mismos
 * archivos, por eso existe recargar().
 *
 * @param {string} nombre  Sin extension. Ej: 'bot'
 * @returns {object}
 */
function cargar(nombre) {
    const enCache = cache.get(nombre);
    if (enCache) return enCache;

    const ruta = path.join(DIR, `${nombre}.json`);

    try {
        const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        cache.set(nombre, datos);
        return datos;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.error('config', `Falta config/${nombre}.json`);
        } else {
            logger.error('config', `config/${nombre}.json no es JSON valido: ${error.message}`);
        }
        // Devolver un objeto vacio deja que quien llama decida con ?? y evita
        // que un config roto tire el proceso entero al arrancar.
        const vacio = {};
        cache.set(nombre, vacio);
        return vacio;
    }
}

/** Relee desde disco. Lo usa el dashboard tras guardar cambios. */
function recargar(nombre) {
    cache.delete(nombre);
    return cargar(nombre);
}

/** Conserva una copia de la configuracion anterior antes de reemplazarla. */
function backup(nombre) {
    const ruta = path.join(DIR, `${nombre}.json`);
    if (!fs.existsSync(ruta)) return;

    try {
        fs.mkdirSync(DIR_BACKUPS, { recursive: true });
        const marca = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(ruta, path.join(DIR_BACKUPS, `${nombre}-${marca}.json`));

        const copias = fs.readdirSync(DIR_BACKUPS)
            .filter(archivo => archivo.startsWith(`${nombre}-`) && archivo.endsWith('.json'))
            .sort()
            .reverse();
        for (const antigua of copias.slice(BACKUPS_A_CONSERVAR)) {
            fs.unlinkSync(path.join(DIR_BACKUPS, antigua));
        }
    } catch (error) {
        logger.warn('config', `No se pudo crear el backup de ${nombre}: ${error.message}`);
    }
}

/** Escribe de forma atomica y refresca la cache. */
function guardar(nombre, datos) {
    const ruta = path.join(DIR, `${nombre}.json`);
    const tmp = `${ruta}.tmp`;

    fs.mkdirSync(DIR, { recursive: true });
    backup(nombre);
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), 'utf8');
    fs.renameSync(tmp, ruta);

    cache.set(nombre, datos);
    return datos;
}

/** Nombres de todos los config/*.json presentes en disco. */
function nombres() {
    try {
        return fs.readdirSync(DIR)
            .filter(archivo => archivo.endsWith('.json'))
            .map(archivo => archivo.slice(0, -5));
    } catch {
        return [];
    }
}

module.exports = { cargar, recargar, guardar, backup, nombres };
