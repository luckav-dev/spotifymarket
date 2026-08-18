'use strict';

const config = require('../utils/config');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const constructor = require('../utils/constructorV2');
const Database = require('../utils/jsonDatabase');
const alertas = require('../utils/alertas');

const ESQUEMA = { contador: 0, programados: {} };
const MAX_FALLOS = 3;

/**
 * Mensajes programados.
 *
 * /say ya sabia construir un Container completo, pero solo podia publicarlo en
 * el momento. Aqui el mensaje se guarda como datos (los mismos bloques que
 * entiende constructorV2) y se publica cuando toca, sobreviviendo a reinicios
 * porque vive en disco y no en un setTimeout.
 */
class SchedulerSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('programados', ESQUEMA);
        this.temporizador = null;
        this.publicando = false;
    }

    get config() {
        return config.cargar('programados');
    }

    iniciar() {
        if (!this.config.activo) return;

        const pendientes = Object.values(this.db.data.programados).filter(p => p.estado === 'pendiente');
        if (pendientes.length) logger.detalle(`${pendientes.length} mensaje(s) programado(s) pendientes`);

        const intervalo = Math.max(15_000, Number(this.config.intervaloRevisionMs) || 30_000);
        this.temporizador = setInterval(() => {
            this.revisar().catch(error => logger.traza('programados', error));
        }, intervalo);
        this.temporizador.unref?.();

        // Se revisa al arrancar: si el bot estuvo caido, hay envios vencidos.
        this.revisar().catch(error => logger.traza('programados', error));
    }

    detener() {
        if (this.temporizador) clearInterval(this.temporizador);
        this.temporizador = null;
    }

    pendientes() {
        return Object.values(this.db.data.programados)
            .filter(p => p.estado === 'pendiente')
            .sort((a, b) => a.enviarEn - b.enviarEn);
    }

    /**
     * @param {object} datos
     * @param {Array} datos.bloques  Bloques de constructorV2
     */
    programar({ canalId, bloques, enviarEn, repeticion, mencion, autorId, nombre }) {
        const maximo = Number(this.config.maximoPorServidor) || 50;
        if (this.pendientes().length >= maximo) {
            throw new Error(`Ya hay ${maximo} mensajes programados. Cancela alguno antes de anadir otro.`);
        }

        const revision = constructor.validar(bloques);
        if (revision.length) {
            throw new Error(`El mensaje no es valido: ${revision.join(' ')}`);
        }

        const id = String(++this.db.data.contador);
        const programado = {
            id,
            nombre: String(nombre ?? '').slice(0, 80) || `Mensaje ${id}`,
            canalId,
            bloques,
            mencion: mencion ?? 'ninguna',
            enviarEn,
            repeticion: repeticion ?? null,
            autorId,
            creadoEn: Date.now(),
            estado: 'pendiente',
            envios: 0,
            fallos: 0,
            ultimoError: ''
        };

        this.db.data.programados[id] = programado;
        this.db.flush();
        return programado;
    }

    cancelar(id) {
        const programado = this.db.data.programados[id];
        if (!programado || programado.estado !== 'pendiente') return null;

        programado.estado = 'cancelado';
        programado.canceladoEn = Date.now();
        this.db.flush();
        return programado;
    }

    async publicar(programado) {
        const canal = await this.client.channels.fetch(programado.canalId).catch(() => null);
        if (!canal?.isTextBased?.()) throw new Error(`El canal ${programado.canalId} no existe o no admite mensajes.`);

        const preparado = constructor.preparar(programado.bloques, this.emojis);
        if (!preparado.ok) throw new Error(`El mensaje ya no es valido: ${preparado.problemas.join(' ')}`);

        // Las menciones se activan solo si se pidieron al programar: un mensaje
        // guardado hace semanas no puede despertarse con un @everyone sorpresa.
        const allowedMentions = programado.mencion === 'everyone'
            ? { parse: ['everyone'] }
            : programado.mencion === 'roles'
                ? { parse: ['roles'] }
                : { parse: [] };

        return canal.send({ ...preparado.carga, allowedMentions });
    }

    async revisar() {
        if (this.publicando) return;
        this.publicando = true;

        try {
            const ahora = Date.now();

            for (const programado of this.pendientes()) {
                if (programado.enviarEn > ahora) break;

                try {
                    const mensaje = await this.publicar(programado);
                    programado.envios += 1;
                    programado.fallos = 0;
                    programado.ultimoError = '';
                    programado.ultimoEnvioEn = ahora;
                    programado.ultimoMensajeId = mensaje.id;

                    const intervalo = this.intervaloRepeticion(programado.repeticion);
                    if (intervalo) {
                        // Se salta lo que se haya perdido en vez de publicar en
                        // rafaga todo lo vencido tras una caida larga.
                        let siguiente = programado.enviarEn + intervalo;
                        while (siguiente <= ahora) siguiente += intervalo;
                        programado.enviarEn = siguiente;
                    } else {
                        programado.estado = 'enviado';
                    }

                    logger.ok('programados', `#${programado.id} «${programado.nombre}» publicado en #${canalNombre(mensaje)}`);
                } catch (error) {
                    programado.fallos += 1;
                    programado.ultimoError = String(error.message).slice(0, 300);

                    if (programado.fallos >= MAX_FALLOS) {
                        programado.estado = 'fallido';
                        logger.error('programados', `#${programado.id} descartado tras ${MAX_FALLOS} intentos: ${error.message}`);
                        alertas.aviso('programados', `El mensaje programado «${programado.nombre}» se ha descartado tras ${MAX_FALLOS} intentos: ${error.message}`);
                    } else {
                        // Reintento con espera creciente en vez de en bucle.
                        programado.enviarEn = ahora + 5 * 60 * 1000 * programado.fallos;
                        logger.warn('programados', `#${programado.id} fallo (${programado.fallos}/${MAX_FALLOS}): ${error.message}`);
                    }
                }

                this.db.flush();
            }
        } finally {
            this.publicando = false;
        }
    }

    intervaloRepeticion(clave) {
        if (!clave || !this.config.permitirRepeticion) return 0;
        return Number(this.config.repeticiones?.[clave]) || 0;
    }

    /** Vista para el staff: en espanol, solo la ve el equipo. */
    resumen() {
        const pendientes = this.pendientes();
        if (!pendientes.length) {
            return ui.info(this.emojis, 'No hay ningún mensaje programado.');
        }

        const lineas = pendientes.slice(0, 15).map(p =>
            `- **#${p.id}** · ${ui.plano(p.nombre)} · <#${p.canalId}> · ${ui.fecha(p.enviarEn, 'R')}` +
            `${p.repeticion ? ` · repite ${p.repeticion}` : ''}` +
            `${p.fallos ? ` · ${p.fallos} fallo(s)` : ''}`
        ).join('\n');

        return ui.panel(this.emojis, {
            emoji: 'programado',
            titulo: 'Mensajes programados',
            subtitulo: `${pendientes.length} pendiente(s).`,
            cuerpo: [lineas],
            pie: 'Cancela uno con /schedule cancel id:<número>.'
        });
    }
}

function canalNombre(mensaje) {
    return mensaje.channel?.name ?? mensaje.channelId;
}

module.exports = SchedulerSystem;
