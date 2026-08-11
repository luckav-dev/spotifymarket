'use strict';

const { ContainerBuilder, TextDisplayBuilder, PermissionFlagsBits } = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = { avisos: {} };

const MAX_TIMEOUT_MS = 28 * 86400000;
const UNIDADES = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const AVISOS_POR_PAGINA = 6;

/**
 * Moderacion: historial de avisos y sanciones automaticas por acumulacion.
 *
 * Los avisos no se borran nunca al aplicar una sancion, solo se desactivan si
 * el usuario apela: el historial es la unica prueba de por que se sanciono.
 */
class ModerationSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('moderacion', ESQUEMA);
    }

    get config() {
        return config.cargar('moderacion');
    }

    /** Duraciones legibles: 30m, 2h, 7d. Devuelve null si no es valida. */
    static parseDuracion(texto) {
        const m = /^(\d+)\s*([smhd])$/i.exec(String(texto).trim());
        if (!m) return null;

        const ms = Number(m[1]) * UNIDADES[m[2].toLowerCase()];
        return ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : null;
    }

    static get maxTimeoutMs() {
        return MAX_TIMEOUT_MS;
    }

    // ---------------------------------------------------------------- avisos

    avisosDe(userId, soloActivos = true) {
        const lista = this.db.data.avisos[userId] ?? [];
        return soloActivos ? lista.filter(a => a.activo) : lista;
    }

    anadirAviso(userId, motivo, moderadorId) {
        const aviso = {
            id: `w${Date.now().toString(36)}`,
            motivo,
            moderadorId,
            fecha: Date.now(),
            activo: true
        };

        (this.db.data.avisos[userId] ??= []).push(aviso);
        this.db.save();

        return aviso;
    }

    desactivarAviso(userId, avisoId) {
        const aviso = this.db.data.avisos[userId]?.find(a => a.id === avisoId);
        if (!aviso || !aviso.activo) return null;

        aviso.activo = false;
        this.db.save();
        return aviso;
    }

    async panelAvisos(userId, pagina = 0, incluirRetirados = false) {
        const usuario = await this.client.users.fetch(userId).catch(() => null);
        const todos = this.avisosDe(userId, !incluirRetirados)
            .slice()
            .sort((a, b) => b.fecha - a.fecha);
        const totalPaginas = Math.max(1, Math.ceil(todos.length / AVISOS_POR_PAGINA));
        const actual = Math.max(0, Math.min(Number(pagina) || 0, totalPaginas - 1));
        const paginaAvisos = todos.slice(actual * AVISOS_POR_PAGINA, (actual + 1) * AVISOS_POR_PAGINA);

        const cuerpo = paginaAvisos.length
            ? paginaAvisos.map(aviso => ui.texto(
                `${aviso.activo ? this.emojis.rol('aviso') : this.emojis.rol('cancelar')} **${ui.plano(aviso.motivo)}**\n` +
                `-# \`${aviso.id}\` · por <@${aviso.moderadorId}> · ${ui.fecha(aviso.fecha)}${aviso.activo ? '' : ' · retirado'}`
            ))
            : [ui.texto('No hay avisos que coincidan con este filtro.')];

        const acciones = todos.length > AVISOS_POR_PAGINA
            ? [ui.paginador(this.emojis, {
                dominio: 'mod', accion: 'avisos', pagina: actual, total: totalPaginas,
                dato: `${userId}:${incluirRetirados ? 1 : 0}`
            })]
            : [];

        return {
            components: [ui.panel(this.emojis, {
                emoji: 'advertencia',
                titulo: `Avisos de ${usuario?.tag ?? userId}`,
                subtitulo: `${todos.length} resultado(s) · ${incluirRetirados ? 'historial completo' : 'solo activos'}`,
                cuerpo,
                acciones,
                pie: todos.length > AVISOS_POR_PAGINA ? `Pagina ${actual + 1} de ${totalPaginas}` : undefined
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async handle(interaction, accion, datos) {
        if (accion !== 'avisos') return undefined;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Ya no tienes permisos para consultar avisos.'));
        }

        const [pagina, userId, incluir] = datos;
        await interaction.deferUpdate();
        return interaction.editReply(await this.panelAvisos(userId, Number(pagina), incluir === '1'));
    }

    /**
     * Aplica la sancion que corresponda al numero de avisos activos.
     * @returns {Promise<{ accion: string, duracionMs?: number }|null>}
     */
    async aplicarEscalado(member, totalActivos) {
        const regla = this.config.escalado?.[String(totalActivos)];
        if (!regla) return null;

        try {
            switch (regla.accion) {
                case 'timeout':
                    await member.timeout(regla.duracionMs, `Acumulacion de ${totalActivos} avisos`);
                    break;
                case 'kick':
                    await member.kick(`Acumulacion de ${totalActivos} avisos`);
                    break;
                case 'ban':
                    await member.ban({ reason: `Acumulacion de ${totalActivos} avisos` });
                    break;
                default:
                    return null;
            }
        } catch (error) {
            logger.error('moderacion', `Escalado fallido sobre ${member.user.tag}: ${error.message}`);
            return null;
        }

        logger.ok('moderacion', `Escalado ${regla.accion} aplicado a ${member.user.tag} (${totalActivos} avisos)`);
        return regla;
    }

    // -------------------------------------------------------------- avisos MD

    /**
     * Avisa al usuario por MD antes de ejecutar la accion: despues de un ban ya
     * no se le puede escribir. Los MD cerrados no pueden bloquear la sancion.
     */
    async notificar(usuario, { titulo, emoji, guild, motivo, extra }) {
        if (!this.config.notificarPorMd) return;

        const c = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${this.emojis.get(emoji)} ${titulo}\n\n` +
                `${this.emojis.get('world')} **Server:** ${guild.name}\n` +
                (extra ? `${this.emojis.get('clock')} **${extra.etiqueta}:** ${extra.valor}\n` : '') +
                `${this.emojis.get('motivo')} **Reason:** ${motivo}`
            )
        );

        await usuario.send({ components: [c], flags: ui.V2 }).catch(() => {});
    }
}

module.exports = ModerationSystem;
