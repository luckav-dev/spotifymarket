'use strict';

const { PermissionFlagsBits } = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const permisos = require('../utils/permisos');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');
const alertas = require('../utils/alertas');

const ESQUEMA = {
    infracciones: {},
    raids: []
};

const INVITACION = /(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/([\w-]+)/i;
const ENLACE = /https?:\/\/([^\s/$.?#]+\.[^\s]*)/gi;

/** El aviso al infractor se borra solo: no tiene por que quedarse en el canal. */
const VIDA_AVISO_MS = 8000;
const MAX_INFRACCIONES_GUARDADAS = 20;

/**
 * Moderacion automatica y proteccion frente a oleadas.
 *
 * El sistema de moderacion existente solo reaccionaba a comandos manuales: todo
 * lo que pasaba mientras no habia nadie mirando se quedaba sin atender. Aqui se
 * actua en el momento y se deja constancia, sin sacar a nadie del flujo normal.
 *
 * Los avisos que ve el infractor van en ingles; el registro para el equipo, en
 * espanol.
 */
class AutoModSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('automod', ESQUEMA);

        /** @type {Map<string, number[]>} marcas de tiempo por autor, para el spam */
        this.actividad = new Map();
        /** @type {number[]} marcas de entrada al servidor, para el antiraid */
        this.entradas = [];
        this.bloqueoRaidHasta = 0;
    }

    get config() {
        return config.cargar('automod');
    }

    iniciar() {
        const cfg = this.config;
        if (!cfg.activo) {
            logger.detalle('Auto-moderacion desactivada en config/automod.json');
            return;
        }

        const activos = Object.entries(cfg.filtros ?? {})
            .filter(([, filtro]) => filtro.activo)
            .map(([nombre]) => nombre);

        logger.detalle(`auto-mod: ${activos.join(', ') || 'sin filtros activos'}${cfg.antiRaid?.activo ? ' · antiraid' : ''}`);
    }

    // ------------------------------------------------------------- utilidades

    exento(mensaje) {
        const cfg = this.config;
        const ignorar = cfg.ignorar ?? {};

        if (ignorar.canales?.includes(mensaje.channel.id)) return true;
        if (ignorar.roles?.some(rol => mensaje.member?.roles.cache.has(rol))) return true;

        const minimo = Number(ignorar.nivelStaffExento ?? 0);
        return minimo > 0 && permisos.nivelDe(mensaje.member) >= minimo;
    }

    /** Registra la infraccion y devuelve cuantas lleva el usuario. */
    anotar(userId, tipo) {
        const lista = this.db.data.infracciones[userId] ?? [];
        lista.push({ tipo, fecha: Date.now() });
        this.db.data.infracciones[userId] = lista.slice(-MAX_INFRACCIONES_GUARDADAS);
        this.db.save();
        return this.db.data.infracciones[userId].length;
    }

    async registrar(mensaje, tipo, accion, detalle) {
        const texto =
            `${this.emojis.rol('automod')} **Auto-moderacion** · \`${tipo}\`\n` +
            `${this.emojis.get('user')} **Autor:** <@${mensaje.author.id}> · \`${mensaje.author.tag}\`\n` +
            `${this.emojis.get('createchannels')} **Canal:** <#${mensaje.channel.id}>\n` +
            `${this.emojis.get('hammer')} **Accion:** ${accion}\n` +
            (detalle ? `${this.emojis.get('motivo')} **Detalle:** ${ui.plano(ui.truncar(detalle, 300))}\n` : '') +
            `-# ${ui.fecha(Date.now(), 'F')}`;

        const canalId = this.config.canalRegistroId;
        if (canalId) {
            const canal = await this.client.channels.fetch(canalId).catch(() => null);
            if (canal?.isTextBased?.()) {
                await canal.send({
                    components: [ui.simple(texto)],
                    flags: ui.V2,
                    allowedMentions: { parse: [] }
                }).catch(() => null);
                return;
            }
        }

        // Sin canal propio, se aprovecha el sistema de logs ya montado.
        await this.client.sistemas?.log?.enviar?.('moderacion', texto).catch(() => null);
    }

    /** Ejecuta la accion configurada para un filtro. */
    async aplicar(mensaje, filtro, tipo, detalle = '') {
        await mensaje.delete().catch(() => null);

        const aviso = await mensaje.channel.send({
            components: [ui.aviso(this.emojis, `<@${mensaje.author.id}>, ${filtro.aviso ?? 'that message was removed.'}`)],
            flags: ui.V2,
            allowedMentions: { users: [mensaje.author.id] }
        }).catch(() => null);
        if (aviso) setTimeout(() => aviso.delete().catch(() => {}), VIDA_AVISO_MS);

        let accionAplicada = 'mensaje borrado';

        if (filtro.accion === 'timeout' && mensaje.member?.moderatable) {
            const duracion = Math.min(Number(filtro.duracionTimeoutMs) || 300000, 28 * 86400000);
            const ok = await mensaje.member.timeout(duracion, `Auto-moderacion: ${tipo}`)
                .then(() => true).catch(() => false);
            if (ok) accionAplicada = `timeout de ${ui.duracion(duracion)}`;
        }

        if (filtro.accion === 'aviso') {
            const mod = this.client.sistemas?.mod;
            if (mod?.anadirAviso) {
                mod.anadirAviso(mensaje.author.id, `Auto-moderacion: ${tipo}`, this.client.user.id);
                accionAplicada = 'aviso registrado';
            }
        }

        const total = this.anotar(mensaje.author.id, tipo);
        await this.registrar(mensaje, tipo, `${accionAplicada} · ${total} infraccion(es) acumuladas`, detalle);
        return true;
    }

    // ---------------------------------------------------------------- filtros

    async revisar(mensaje) {
        const cfg = this.config;
        if (!cfg.activo || !mensaje.guild || mensaje.author.bot) return false;
        if (this.exento(mensaje)) return false;

        const filtros = cfg.filtros ?? {};
        const contenido = mensaje.content ?? '';

        if (filtros.invitaciones?.activo) {
            const encontrada = contenido.match(INVITACION);
            if (encontrada && !(filtros.invitaciones.permitirPropias && await this.esInvitacionPropia(mensaje.guild, encontrada[1]))) {
                return this.aplicar(mensaje, filtros.invitaciones, 'invitacion', encontrada[0]);
            }
        }

        if (filtros.estafas?.activo) {
            for (const patron of filtros.estafas.patrones ?? []) {
                let regex;
                try {
                    regex = new RegExp(patron, 'i');
                } catch {
                    // Un patron mal escrito en config no puede tumbar el filtro.
                    logger.warn('automod', `Patron de estafa invalido, se ignora: ${patron}`);
                    continue;
                }
                if (regex.test(contenido)) {
                    return this.aplicar(mensaje, filtros.estafas, 'estafa', patron);
                }
            }
        }

        if (filtros.enlaces?.activo) {
            const permitidos = filtros.enlaces.listaBlanca ?? [];
            for (const [, dominio] of contenido.matchAll(ENLACE)) {
                const limpio = String(dominio).toLowerCase().replace(/^www\./, '').split('/')[0];
                if (permitidos.some(ok => limpio === ok || limpio.endsWith(`.${ok}`))) continue;
                return this.aplicar(mensaje, filtros.enlaces, 'enlace', limpio);
            }
        }

        if (filtros.menciones?.activo) {
            const total = mensaje.mentions.users.size + mensaje.mentions.roles.size;
            if (total > Number(filtros.menciones.maximo ?? 6)) {
                return this.aplicar(mensaje, filtros.menciones, 'menciones', `${total} menciones`);
            }
        }

        if (filtros.mayusculas?.activo && contenido.length >= Number(filtros.mayusculas.minimoCaracteres ?? 25)) {
            const letras = contenido.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '');
            if (letras.length >= 10) {
                const proporcion = (letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length / letras.length) * 100;
                if (proporcion >= Number(filtros.mayusculas.porcentaje ?? 75)) {
                    return this.aplicar(mensaje, filtros.mayusculas, 'mayusculas', `${Math.round(proporcion)}%`);
                }
            }
        }

        if (filtros.spam?.activo && this.esSpam(mensaje, filtros.spam)) {
            return this.aplicar(mensaje, filtros.spam, 'spam', `${filtros.spam.mensajes} mensajes en ${filtros.spam.ventanaMs} ms`);
        }

        return false;
    }

    /** Ventana deslizante por autor. */
    esSpam(mensaje, filtro) {
        const ahora = Date.now();
        const ventana = Number(filtro.ventanaMs) || 7000;
        const limite = Number(filtro.mensajes) || 5;

        const marcas = (this.actividad.get(mensaje.author.id) ?? []).filter(t => ahora - t < ventana);
        marcas.push(ahora);
        this.actividad.set(mensaje.author.id, marcas);

        // Poda oportunista para que el mapa no crezca con cada usuario que pasa.
        if (this.actividad.size > 2000) {
            for (const [id, lista] of this.actividad) {
                if (!lista.length || ahora - lista[lista.length - 1] > ventana * 4) this.actividad.delete(id);
            }
        }

        if (marcas.length < limite) return false;
        this.actividad.set(mensaje.author.id, []);
        return true;
    }

    async esInvitacionPropia(guild, codigo) {
        const invitaciones = await guild.invites.fetch().catch(() => null);
        return Boolean(invitaciones?.some(invitacion => invitacion.code === codigo));
    }

    // --------------------------------------------------------------- antiraid

    /**
     * Deteccion de oleadas de entrada.
     *
     * El sistema de bienvenida ya detectaba cuentas nuevas, pero solo lo
     * comentaba. Aqui se actua: si entran demasiadas cuentas en poco tiempo, se
     * cierra la puerta un rato y se avisa al equipo.
     */
    async miembroEntra(member) {
        const cfg = this.config.antiRaid ?? {};
        if (!this.config.activo || !cfg.activo) return;

        const ahora = Date.now();
        const ventana = Number(cfg.ventanaMs) || 60000;
        this.entradas = this.entradas.filter(t => ahora - t < ventana);
        this.entradas.push(ahora);

        const cuentaNueva = Number(cfg.edadMinimaCuentaMs) > 0
            && ahora - member.user.createdTimestamp < Number(cfg.edadMinimaCuentaMs);

        if (this.bloqueoRaidHasta > ahora) {
            await this.contenerEntrada(member, 'oleada en curso');
            return;
        }

        if (this.entradas.length < Number(cfg.entradasPorVentana || 8)) {
            if (cuentaNueva) await this.registrarCuentaNueva(member);
            return;
        }

        // Se ha superado el umbral: se activa el bloqueo temporal.
        this.bloqueoRaidHasta = ahora + (Number(cfg.duracionBloqueoMs) || 900000);
        this.db.data.raids.push({ en: ahora, entradas: this.entradas.length, hasta: this.bloqueoRaidHasta });
        this.db.data.raids = this.db.data.raids.slice(-50);
        this.db.flush();

        logger.warn('antiraid', `${this.entradas.length} entradas en ${Math.round(ventana / 1000)} s. Bloqueo activo ${ui.duracion(this.bloqueoRaidHasta - ahora)}.`);
        alertas.critico('antiraid', `Posible raid: ${this.entradas.length} entradas en ${Math.round(ventana / 1000)} s. Bloqueo activo durante ${ui.duracion(this.bloqueoRaidHasta - ahora)}.`);

        await this.avisarRaid(member.guild, this.entradas.length);
        await this.contenerEntrada(member, 'inicio de oleada');
    }

    /** Contiene a un miembro que llega durante una oleada. */
    async contenerEntrada(member, motivo) {
        const cfg = this.config.antiRaid ?? {};

        if (cfg.accion === 'expulsar' && member.kickable) {
            await member.kick(`Antiraid: ${motivo}`).catch(() => null);
            return;
        }

        if (member.moderatable) {
            const duracion = Math.max(0, this.bloqueoRaidHasta - Date.now()) || 900000;
            await member.timeout(Math.min(duracion, 28 * 86400000), `Antiraid: ${motivo}`).catch(() => null);
        }
    }

    async registrarCuentaNueva(member) {
        await this.client.sistemas?.log?.enviar?.('miembros',
            `${this.emojis.rol('antiraid')} **Cuenta reciente**\n` +
            `${this.emojis.get('user')} <@${member.id}> · \`${member.user.tag}\`\n` +
            `${this.emojis.get('clock')} **Creada:** ${ui.fecha(member.user.createdTimestamp, 'R')}\n` +
            `-# Vigilancia informativa: no se ha aplicado ninguna accion.`
        ).catch(() => null);
    }

    async avisarRaid(guild, entradas) {
        const cfg = this.config.antiRaid ?? {};
        const canalId = cfg.canalAvisoId || this.config.canalRegistroId;
        if (!canalId) return;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) return;

        const mencion = cfg.mencionarRolId ? `<@&${cfg.mencionarRolId}>\n` : '';

        await canal.send({
            components: [ui.panel(this.emojis, {
                emoji: 'antiraid',
                titulo: 'Posible raid detectado',
                subtitulo: `${entradas} entradas en ${Math.round((Number(cfg.ventanaMs) || 60000) / 1000)} segundos.`,
                cuerpo: [ui.campos(this.emojis, [
                    { emoji: 'miembros', etiqueta: 'Miembros ahora', valor: String(guild.memberCount), codigo: true },
                    { emoji: 'moderacion', etiqueta: 'Contencion', valor: cfg.accion === 'expulsar' ? 'expulsion' : 'timeout automatico' },
                    { emoji: 'reloj', etiqueta: 'Bloqueo hasta', valor: ui.fecha(this.bloqueoRaidHasta, 'T') }
                ])],
                pie: 'Las entradas durante el bloqueo se contienen automaticamente. Revisa y levanta el bloqueo con /automod raid-off si es una falsa alarma.'
            })],
            flags: ui.V2,
            allowedMentions: cfg.mencionarRolId ? { roles: [cfg.mencionarRolId] } : { parse: [] }
        }).catch(() => null);
    }

    /** Levanta el bloqueo antes de tiempo. */
    levantarBloqueo() {
        const estaba = this.bloqueoRaidHasta > Date.now();
        this.bloqueoRaidHasta = 0;
        this.entradas = [];
        return estaba;
    }

    enBloqueo() {
        return this.bloqueoRaidHasta > Date.now();
    }

    estadisticas() {
        const infracciones = Object.values(this.db.data.infracciones).flat();
        const ultimas24h = infracciones.filter(i => Date.now() - i.fecha < 86400000);
        const porTipo = {};
        for (const i of ultimas24h) porTipo[i.tipo] = (porTipo[i.tipo] ?? 0) + 1;

        return {
            usuarios: Object.keys(this.db.data.infracciones).length,
            total: infracciones.length,
            ultimas24h: ultimas24h.length,
            porTipo,
            raids: this.db.data.raids.length,
            bloqueado: this.enBloqueo()
        };
    }

    /** Permiso que el bot necesita para que los filtros sirvan de algo. */
    permisosSuficientes(guild) {
        const yo = guild.members.me;
        return Boolean(yo?.permissions.has(PermissionFlagsBits.ManageMessages)
            && yo?.permissions.has(PermissionFlagsBits.ModerateMembers));
    }
}

module.exports = AutoModSystem;
