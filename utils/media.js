'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

const config = require('./config');

const RAIZ = path.resolve(__dirname, '..');
const DIR_ASSETS = path.join(RAIZ, 'assets');

/** Resuelve una clave de config/brand.json, una URL https o un archivo de assets/. */
function origenDe(valor) {
    const limpio = String(valor ?? '').trim();
    if (!limpio) return '';
    return config.cargar('brand').assets?.[limpio] ?? limpio;
}

function esHttps(valor) {
    try {
        return new URL(valor).protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Convierte una imagen configurable en URL utilizable por Components V2.
 * Los archivos locales quedan restringidos a assets/ y se adjuntan sin
 * modificarlos. Las URL https pasan directas.
 */
function resolver(valor, nombreAdjunto = 'media.png') {
    const origen = origenDe(valor);
    if (!origen) return null;
    if (esHttps(origen)) return { url: origen, files: [] };

    const ruta = path.resolve(RAIZ, origen);
    const relativa = path.relative(DIR_ASSETS, ruta);
    if (relativa.startsWith('..') || path.isAbsolute(relativa) || !fs.existsSync(ruta)) return null;

    const extension = path.extname(ruta);
    const base = path.basename(nombreAdjunto, path.extname(nombreAdjunto))
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 70) || 'media';
    const nombre = `${base}${extension}`;

    return {
        url: `attachment://${nombre}`,
        files: [new AttachmentBuilder(ruta, { name: nombre })]
    };
}

module.exports = { resolver, origenDe, esHttps };
