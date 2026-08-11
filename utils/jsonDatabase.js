'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('./logger');

const DIR = path.resolve(__dirname, '..', 'database');
const DIR_BACKUPS = path.join(DIR, 'backups');
const RETRASO_GUARDADO_MS = 3000;
const BACKUPS_A_CONSERVAR = 10;

/** @type {Map<string, Database>} */
const instancias = new Map();

/** Fusion profunda del esquema: los objetos nuevos aparecen sin pisar datos. */
function completar(esquema, datos) {
    if (!esquema || typeof esquema !== 'object' || Array.isArray(esquema)) return datos;
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return structuredClone(esquema);

    const salida = structuredClone(datos);
    for (const [clave, valor] of Object.entries(esquema)) {
        if (!(clave in salida)) salida[clave] = structuredClone(valor);
        else if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
            salida[clave] = completar(valor, salida[clave]);
        }
    }
    return salida;
}

/**
 * Base de datos JSON por dominio, con escritura atomica y diferida.
 *
 * Una instancia por dominio: instancias se cachea por nombre para que dos
 * modulos que pidan 'tickets' compartan el mismo objeto en memoria y no vean
 * datos distintos.
 */
class Database {
    /**
     * @param {string} nombre  Dominio, sin extension. Ej: 'tickets'
     * @param {object} porDefecto  Esquema inicial si el archivo no existe
     */
    constructor(nombre, porDefecto = {}) {
        const existente = instancias.get(nombre);
        if (existente) return existente;

        this.nombre = nombre;
        this.ruta = path.join(DIR, `${nombre}.json`);
        this.porDefecto = porDefecto;
        this.sucio = false;
        this.temporizador = null;

        fs.mkdirSync(DIR, { recursive: true });
        this.data = this.#cargar();

        instancias.set(nombre, this);
    }

    #cargar() {
        if (!fs.existsSync(this.ruta)) {
            const inicial = structuredClone(this.porDefecto);
            this.#escribir(inicial);
            return inicial;
        }

        try {
            const datos = JSON.parse(fs.readFileSync(this.ruta, 'utf8'));
            // Rellena tambien claves anidadas nuevas sin tocar datos existentes.
            return completar(this.porDefecto, datos);
        } catch (error) {
            logger.error(`db:${this.nombre}`, `JSON invalido: ${error.message}`);
            const corrupto = `${this.ruta}.corrupto-${Date.now()}`;
            fs.renameSync(this.ruta, corrupto);
            logger.error(`db:${this.nombre}`, `Guardado como ${path.basename(corrupto)}. Arrancando vacio.`);

            const inicial = structuredClone(this.porDefecto);
            this.#escribir(inicial);
            return inicial;
        }
    }

    /** Escritura atomica: tmp + rename. Un corte no deja un JSON truncado. */
    #escribir(datos) {
        const tmp = `${this.ruta}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), 'utf8');
        fs.renameSync(tmp, this.ruta);
    }

    /** Marca sucio y programa el volcado. No bloquea. */
    save() {
        this.sucio = true;
        if (this.temporizador) return;

        this.temporizador = setTimeout(() => {
            this.temporizador = null;
            this.flush();
        }, RETRASO_GUARDADO_MS);
        this.temporizador.unref?.();
    }

    /**
     * Vuelca ya, de forma sincrona. Usar al apagar el bot.
     * Escribe siempre, aunque no se haya llamado a save(): si alguien muta
     * data y llama a flush() directamente, los cambios no se pueden perder.
     */
    flush() {
        try {
            this.#escribir(this.data);
            this.sucio = false;
        } catch (error) {
            logger.error(`db:${this.nombre}`, `Error guardando: ${error.message}`);
        }
    }

    /** Copia con marca de tiempo, conservando las N ultimas. */
    backup() {
        try {
            fs.mkdirSync(DIR_BACKUPS, { recursive: true });
            const marca = new Date().toISOString().replace(/[:.]/g, '-');
            fs.writeFileSync(
                path.join(DIR_BACKUPS, `${this.nombre}-${marca}.json`),
                JSON.stringify(this.data, null, 2),
                'utf8'
            );

            const previas = fs.readdirSync(DIR_BACKUPS)
                .filter(f => f.startsWith(`${this.nombre}-`))
                .sort()
                .reverse();

            for (const vieja of previas.slice(BACKUPS_A_CONSERVAR)) {
                fs.unlinkSync(path.join(DIR_BACKUPS, vieja));
            }
        } catch (error) {
            logger.error(`db:${this.nombre}`, `Error en backup: ${error.message}`);
        }
    }

    /** Reemplaza todo el contenido y guarda. */
    reset() {
        this.data = structuredClone(this.porDefecto);
        this.sucio = true;
        this.flush();
    }

    /** @returns {Database[]} */
    static all() {
        return [...instancias.values()];
    }

    static flushAll() {
        for (const db of instancias.values()) db.flush();
    }

    static backupAll() {
        for (const db of instancias.values()) db.backup();
    }
}

module.exports = Database;
