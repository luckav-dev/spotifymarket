'use strict';

const config = require('../utils/config');
const logger = require('../utils/logger');
const permisos = require('../utils/permisos');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');
const { aplicarPresencia } = require('../utils/presencia');

const ESQUEMA = {
    activo: false,
    motivo: '',
    activadoPor: null,
    activadoEn: 0,
    hasta: 0,
    aviso: { canalId: '', mensajeId: '' }
};

/**
 * Modo mantenimiento global.
 *
 * Antes, para parar las ventas durante una incidencia habia que apagar el bot,
 * y entonces tampoco funcionaban los tickets ni los logs ni nada. Esto corta
 * solo lo que toca (compras y tickets nuevos) y lo explica al cliente, en vez
 * de dejarlo delante de un bot que no responde.
 *
 * El staff a partir del nivel configurado sigue pudiendo operar con normalidad.
 */
class MaintenanceSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('mantenimiento', ESQUEMA);
    }

    get config() {
        return config.cargar('mantenimiento');
    }

    iniciar() {
        // Un mantenimiento con fecha de fin no puede sobrevivir a un reinicio.
        if (this.db.data.activo && this.db.data.hasta && Date.now() > this.db.data.hasta) {
            this.desactivar(null).catch(error => logger.traza('mantenimiento', error));
            return;
        }
        if (this.db.data.activo) {
            logger.warn('mantenimiento', `Activo desde ${new Date(this.db.data.activadoEn).toISOString()}. Las compras y los tickets nuevos estan pausados.`);
            this.programarFin();
        }
    }

    activo() {
        if (!this.db.data.activo) return false;
        if (this.db.data.hasta && Date.now() > this.db.data.hasta) {
            this.desactivar(null).catch(() => {});
            return false;
        }
        return true;
    }

    /** El staff autorizado atraviesa el mantenimiento sin bloqueos. */
    exento(member) {
        const minimo = Number(this.config.excepciones?.nivelMinimoStaff ?? 3);
        return permisos.nivelDe(member) >= minimo;
    }

    /**
     * Puerta unica para el resto de sistemas.
     * @returns {null|object} Container a responder, o null si se puede seguir.
     */
    bloquea(member) {
        if (!this.activo() || this.exento(member)) return null;
        return this.aviso();
    }

    aviso() {
        const cfg = this.config;
        const hasta = this.db.data.hasta
            ? `\n${this.emojis.rol('reloj')} **Expected back:** ${ui.fecha(this.db.data.hasta, 'R')}`
            : '';

        return ui.panel(this.emojis, {
            emoji: 'mantenimiento',
            titulo: cfg.titulo || 'SCHEDULED MAINTENANCE',
            cuerpo: [
                `> ${cfg.descripcion || cfg.mensajeCorto}`,
                this.db.data.motivo ? `${this.emojis.rol('info')} **Details:** ${ui.plano(this.db.data.motivo)}${hasta}` : hasta.trim()
            ].filter(Boolean),
            pie: 'Thanks for your patience. Nothing you already purchased is affected.'
        });
    }

    programarFin() {
        if (this.temporizador) clearTimeout(this.temporizador);
        if (!this.db.data.hasta) return;

        const restante = this.db.data.hasta - Date.now();
        if (restante <= 0) return;

        // setTimeout no admite retrasos mayores de ~24,8 dias.
        this.temporizador = setTimeout(() => {
            this.desactivar(null).catch(error => logger.traza('mantenimiento', error));
        }, Math.min(restante, 2 ** 31 - 1));
        this.temporizador.unref?.();
    }

    async activar(usuario, motivo, duracionMs = 0) {
        this.db.data = {
            ...this.db.data,
            activo: true,
            motivo: String(motivo ?? '').slice(0, 400),
            activadoPor: usuario?.id ?? null,
            activadoEn: Date.now(),
            hasta: duracionMs ? Date.now() + duracionMs : 0
        };
        this.db.flush();

        this.programarFin();
        await this.aplicarPresenciaMantenimiento();
        await this.publicarAviso();

        logger.warn('mantenimiento', `Activado por ${usuario?.tag ?? 'el sistema'}${motivo ? `: ${motivo}` : ''}`);
        return this.db.data;
    }

    async desactivar(usuario) {
        if (this.temporizador) clearTimeout(this.temporizador);
        this.temporizador = null;

        const estaba = this.db.data.activo;
        this.db.data = { ...ESQUEMA, aviso: this.db.data.aviso };
        this.db.flush();

        await this.retirarAviso();
        aplicarPresencia(this.client);

        if (estaba) logger.ok('mantenimiento', `Desactivado por ${usuario?.tag ?? 'vencimiento automatico'}`);
        return estaba;
    }

    async aplicarPresenciaMantenimiento() {
        const presencia = this.config.presencia ?? {};
        if (!presencia.texto || !this.client.user) return;

        this.client.user.setPresence({
            status: presencia.estado || 'idle',
            activities: [{ name: 'custom', type: 4, state: presencia.texto }]
        });
    }

    async publicarAviso() {
        const canalId = this.config.avisarEnCanalId;
        if (!canalId) return null;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) return null;

        await this.retirarAviso();
        const mensaje = await canal.send({
            components: [this.aviso()],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).catch(() => null);

        if (mensaje) {
            this.db.data.aviso = { canalId: canal.id, mensajeId: mensaje.id };
            this.db.save();
        }
        return mensaje;
    }

    async retirarAviso() {
        const { canalId, mensajeId } = this.db.data.aviso ?? {};
        if (!canalId || !mensajeId) return;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        const mensaje = canal?.isTextBased?.()
            ? await canal.messages.fetch(mensajeId).catch(() => null)
            : null;
        await mensaje?.delete().catch(() => null);

        this.db.data.aviso = { canalId: '', mensajeId: '' };
        this.db.save();
    }

    async handle(interaction, accion) {
        if (accion !== 'info') return undefined;
        return ui.responderEfimero(interaction, this.aviso());
    }
}

module.exports = MaintenanceSystem;
