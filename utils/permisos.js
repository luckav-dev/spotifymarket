'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const NIVEL_ADMINISTRADOR = 100;

/**
 * Permisos del staff por niveles.
 *
 * Se trabaja con niveles y no con roles sueltos para poder preguntar
 * "nivel >= X" en vez de enumerar roles en cada comprobacion: anadir un rol
 * nuevo es una linea en config/permissions.json y ninguna en el codigo.
 */

/** Nivel mas alto que alcanza el miembro por sus roles. 0 si no es staff. */
function nivelDe(member) {
    if (!member) return 0;
    if (member.guild?.ownerId === member.id || member.permissions?.has?.(PermissionFlagsBits.Administrator)) {
        return NIVEL_ADMINISTRADOR;
    }

    const { roles = {} } = config.cargar('permissions');
    let nivel = 0;

    for (const rol of Object.values(roles)) {
        if (rol.roleId && member.roles.cache.has(rol.roleId)) {
            nivel = Math.max(nivel, rol.nivel);
        }
    }

    return nivel;
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {string} accion  Clave de config/permissions.json > permisos
 */
function puede(member, accion) {
    const { permisos = {} } = config.cargar('permissions');
    const requerido = permisos[accion];

    // Una accion sin nivel declarado se trata como cerrada: es mas seguro
    // bloquearla y que se note, que abrirla a todo el servidor por un typo.
    if (requerido === undefined) return false;

    return nivelDe(member) >= requerido;
}

/** IDs de los roles de staff que estan configurados. */
function rolesStaff() {
    const { roles = {} } = config.cargar('permissions');
    return Object.values(roles).map(r => r.roleId).filter(Boolean);
}

/**
 * Comprueba que el ejecutor puede actuar sobre el objetivo, en ambos sentidos.
 * Sin esta validacion un moderador podria sancionar a un administrador.
 *
 * @returns {string|null} Motivo del rechazo, o null si puede actuar.
 */
function puedeActuarSobre(ejecutor, objetivo, yo) {
    if (!ejecutor || !objetivo || !yo) return 'No se ha podido comprobar la jerarquia de permisos.';
    if (objetivo.id === ejecutor.id) {
        return 'No puedes hacer eso contigo mismo.';
    }
    if (objetivo.id === objetivo.guild.ownerId) {
        return 'No se puede actuar sobre el dueno del servidor.';
    }
    if (
        ejecutor.id !== objetivo.guild.ownerId &&
        ejecutor.roles.highest.position <= objetivo.roles.highest.position
    ) {
        return 'Ese usuario tiene un rol igual o superior al tuyo.';
    }
    if (yo.roles.highest.position <= objetivo.roles.highest.position) {
        return 'No puedo actuar sobre ese usuario: su rol esta por encima del mio.';
    }
    return null;
}

module.exports = { nivelDe, puede, rolesStaff, puedeActuarSobre };
