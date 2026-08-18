'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
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
        this.cola = Promise.resolve();

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

    /**
     * Igual que #escribir, pero sin bloquear el bucle de eventos.
     *
     * Serializar y escribir un JSON de varios MB con writeFileSync paraba el
     * bot entero cada pocos segundos: mientras dura, no se atiende ninguna
     * interaccion. Este es el camino normal; el sincrono queda para el apagado.
     */
    async #escribirAsync(datos) {
        const tmp = `${this.ruta}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(datos, null, 2), 'utf8');
        await fsp.rename(tmp, this.ruta);
    }

    /** Marca sucio y programa el volcado. No bloquea. */
    save() {
        this.sucio = true;
        if (this.temporizador) return;

        this.temporizador = setTimeout(() => {
            this.temporizador = null;
            this.flushAsync().catch(error =>
                logger.error(`db:${this.nombre}`, `Error guardando: ${error.message}`)
            );
        }, RETRASO_GUARDADO_MS);
        this.temporizador.unref?.();
    }

    /**
     * Volcado asincrono, encolado.
     *
     * La cola evita que dos guardados solapados se pisen el archivo temporal:
     * ambos usan la misma ruta .tmp y el rename del primero podria llevarse el
     * contenido a medio escribir del segundo.
     */
    flushAsync() {
        this.cola = this.cola.then(async () => {
            if (!this.sucio) return;
            // Se marca antes de escribir: cualquier mutacion que llegue durante
            // la escritura vuelve a ensuciar y provoca otro volcado.
            this.sucio = false;
            try {
                await this.#escribirAsync(this.data);
            } catch (error) {
                this.sucio = true;
                throw error;
            }
        }, () => {});

        return this.cola;
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

    /**
     * Recorta una coleccion que crece sin fin.
     *
     * Los tickets archivados, las valoraciones y las resenas no dejan de
     * acumularse, y como el archivo se reescribe entero en cada guardado, el
     * coste de cada escritura sube con el historico. Lo que se poda se guarda
     * antes en un archivo mensual, asi no se pierde nada.
     *
     * @param {string} clave     Propiedad de data a podar (objeto o array).
     * @param {number} conservar Cuantos elementos recientes se quedan.
     * @param {(item: any) => number} fecha  Extrae la marca de tiempo del elemento.
     */
    podar(clave, conservar, fecha = item => Number(item?.fecha ?? item?.creadoEn ?? 0)) {
        const valor = this.data[clave];
        const esArray = Array.isArray(valor);
        const entradas = esArray
            ? valor.map((item, indice) => [String(indice), item])
            : Object.entries(valor ?? {});

        if (entradas.length <= conservar) return 0;

        entradas.sort((a, b) => fecha(b[1]) - fecha(a[1]));
        const sobrantes = entradas.slice(conservar);

        this.#archivar(clave, sobrantes.map(([, item]) => item));

        if (esArray) {
            this.data[clave] = entradas.slice(0, conservar).map(([, item]) => item);
        } else {
            for (const [id] of sobrantes) delete this.data[clave][id];
        }

        this.save();
        logger.detalle(`db:${this.nombre} · ${sobrantes.length} entrada(s) de '${clave}' movidas al historico`);
        return sobrantes.length;
    }

    /** Vuelca lo podado a database/historico/<dominio>-<clave>-<mes>.json */
    #archivar(clave, items) {
        if (!items.length) return;

        try {
            const dir = path.join(DIR, 'historico');
            fs.mkdirSync(dir, { recursive: true });

            const mes = new Date().toISOString().slice(0, 7);
            const ruta = path.join(dir, `${this.nombre}-${clave}-${mes}.json`);
            const previo = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : [];

            fs.writeFileSync(ruta, JSON.stringify([...previo, ...items], null, 2), 'utf8');
        } catch (error) {
            logger.error(`db:${this.nombre}`, `No se pudo archivar '${clave}': ${error.message}`);
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
