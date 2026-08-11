'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const logger = require('./logger');
const config = require('./config');

const EXTENSIONES = new Set(['.png', '.jpg', '.jpeg', '.gif']);
const MAX_BYTES = 256 * 1024;
const PAUSA_SUBIDA_MS = 350;

/**
 * Gestiona los Application Emojis del bot.
 *
 * La carpeta emojis/ es la fuente de verdad: cada imagen se sube una vez a la
 * aplicacion y su ID queda cacheado en emojis.json. En el codigo los emojis se
 * referencian solo por nombre mediante get().
 */
class EmojiManager {
    /**
     * @param {import('discord.js').Client} client
     * @param {{ dir?: string, cache?: string }} [opciones]
     */
    constructor(client, opciones = {}) {
        this.client = client;
        const raiz = path.resolve(__dirname, '..');
        this.dir = opciones.dir ?? path.join(raiz, 'emojis');
        this.rutaCache = opciones.cache ?? path.join(raiz, 'emojis.json');
        this.cache = this.#leerCache();
        this.avisados = new Set();
    }

    #leerCache() {
        try {
            return JSON.parse(fs.readFileSync(this.rutaCache, 'utf8'));
        } catch {
            return {};
        }
    }

    #guardarCache() {
        const tmp = `${this.rutaCache}.tmp`;
        const ordenado = Object.fromEntries(
            Object.entries(this.cache).sort(([a], [b]) => a.localeCompare(b))
        );
        fs.writeFileSync(tmp, JSON.stringify(ordenado, null, 2), 'utf8');
        fs.renameSync(tmp, this.rutaCache);
    }

    /** Convierte un nombre de archivo en un nombre de emoji valido para Discord. */
    static sanear(nombre) {
        let limpio = nombre.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
        if (limpio.length < 2) limpio = `${limpio}_e`;
        return limpio.slice(0, 32);
    }

    /**
     * Sincroniza la carpeta emojis/ con los Application Emojis.
     * Reutiliza los que ya existen y sube solo los que faltan.
     * @returns {Promise<{ creados: number, existentes: number, fallidos: string[] }>}
     */
    async sync() {
        const resultado = { creados: 0, existentes: 0, fallidos: [] };

        if (!this.client.application) {
            logger.warn('emojis', 'La aplicacion no esta lista todavia.');
            return resultado;
        }

        if (!fs.existsSync(this.dir)) {
            logger.warn('emojis', `No existe la carpeta ${this.dir}`);
            return resultado;
        }

        try {
            await this.client.application.emojis.fetch();
        } catch (error) {
            logger.error('emojis', `No se pudieron obtener los emojis de la aplicacion: ${error.message}`);
            return resultado;
        }

        const archivos = (await fsp.readdir(this.dir))
            .filter(f => EXTENSIONES.has(path.extname(f).toLowerCase()));

        for (const archivo of archivos) {
            const clave = path.parse(archivo).name;
            const nombre = EmojiManager.sanear(clave);
            const ruta = path.join(this.dir, archivo);

            const existente = this.client.application.emojis.cache.find(e => e.name === nombre);
            if (existente) {
                this.cache[clave] = `<${existente.animated ? 'a' : ''}:${existente.name}:${existente.id}>`;
                resultado.existentes++;
                continue;
            }

            try {
                const { size } = await fsp.stat(ruta);
                if (size > MAX_BYTES) {
                    logger.warn('emojis', `${archivo} supera los 256 KB (${Math.round(size / 1024)} KB).`);
                    resultado.fallidos.push(clave);
                    continue;
                }

                const creado = await this.client.application.emojis.create({
                    attachment: ruta,
                    name: nombre
                });

                this.cache[clave] = `<${creado.animated ? 'a' : ''}:${creado.name}:${creado.id}>`;
                resultado.creados++;
                logger.ok('emojis', `Creado ${clave}`);

                // Espaciado para no chocar con el rate limit en el primer arranque.
                await new Promise(r => setTimeout(r, PAUSA_SUBIDA_MS));
            } catch (error) {
                logger.error('emojis', `Error subiendo ${archivo}: ${error.message}`);
                resultado.fallidos.push(clave);
            }
        }

        this.#guardarCache();
        return resultado;
    }

    /**
     * Devuelve el emoji listo para interpolar en un string.
     * Si no existe devuelve cadena vacia y avisa una sola vez por consola:
     * un panel al que le falta un icono debe verse limpio, no con un
     * interrogante que parezca intencionado.
     * @param {string} nombre
     * @returns {string}
     */
    get(nombre) {
        if (typeof nombre !== 'string') return '';
        if (nombre.startsWith('<:') || nombre.startsWith('<a:')) return nombre;

        const valor = this.cache[nombre];
        if (valor) return valor;

        if (!this.avisados.has(nombre)) {
            this.avisados.add(nombre);
            logger.warn('emojis', `Falta el emoji '${nombre}' - anade emojis/${nombre}.png`);
        }
        return '';
    }

    /**
     * Devuelve el emoji asociado a un rol semantico de config/emojis.json.
     *
     * Los roles desacoplan el significado del archivo: 'info' puede apuntar hoy
     * a notificacion.png y manana a otro sin tocar una linea de codigo. Una
     * clave sin rol declarado se busca directamente como nombre de archivo.
     *
     * @param {string} clave
     * @returns {string}
     */
    rol(clave) {
        const roles = config.cargar('emojis').roles ?? {};
        return this.get(roles[clave] ?? clave);
    }

    /** @returns {boolean} */
    has(nombre) {
        return Boolean(this.cache[nombre]);
    }

    /** @returns {Record<string, string>} */
    all() {
        return { ...this.cache };
    }

    /** Nombres referenciados en codigo que no tienen archivo. Util al arrancar. */
    faltantes() {
        return [...this.avisados];
    }
}

module.exports = EmojiManager;
