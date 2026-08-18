'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');

const permisos = require('../utils/permisos');
const config = require('../utils/config');

function miembro({ roles = [], id = '1', ownerId = '999', admin = false, posicion = 1 } = {}) {
    return {
        id,
        guild: { ownerId },
        permissions: { has: bit => admin && bit === PermissionFlagsBits.Administrator },
        roles: { cache: new Map(roles.map(r => [r, {}])), highest: { position: posicion } }
    };
}

test('nivelDe devuelve 0 para quien no tiene ningun rol de staff', () => {
    assert.equal(permisos.nivelDe(miembro()), 0);
});

test('nivelDe da 100 al dueno y al administrador', () => {
    assert.equal(permisos.nivelDe(miembro({ id: '999', ownerId: '999' })), 100);
    assert.equal(permisos.nivelDe(miembro({ admin: true })), 100);
});

test('nivelDe toma el nivel mas alto cuando hay varios roles', () => {
    const roles = Object.values(config.cargar('permissions').roles).map(r => r.roleId);
    const esperado = Math.max(...Object.values(config.cargar('permissions').roles).map(r => r.nivel));
    assert.equal(permisos.nivelDe(miembro({ roles })), esperado);
});

test('puede() falla cerrado ante una accion sin nivel declarado', () => {
    assert.equal(permisos.puede(miembro({ admin: true }), 'accion-que-no-existe'), false);
});

test('puedeActuarSobre bloquea el autocastigo y al dueno', () => {
    const yo = miembro({ id: 'bot', posicion: 50 });
    const actor = miembro({ id: 'a', posicion: 10 });
    assert.match(permisos.puedeActuarSobre(actor, miembro({ id: 'a', posicion: 10 }), yo), /contigo mismo/);
    assert.match(permisos.puedeActuarSobre(actor, miembro({ id: '999', ownerId: '999' }), yo), /dueno/);
});

test('puedeActuarSobre exige jerarquia estricta en ambos sentidos', () => {
    const yo = miembro({ id: 'bot', posicion: 50 });
    const actor = miembro({ id: 'a', posicion: 5 });

    // El objetivo esta por encima del ejecutor.
    assert.match(permisos.puedeActuarSobre(actor, miembro({ id: 'b', posicion: 9 }), yo), /igual o superior/);

    // El objetivo esta por encima del bot.
    const actorAlto = miembro({ id: 'a', posicion: 99 });
    assert.match(
        permisos.puedeActuarSobre(actorAlto, miembro({ id: 'b', posicion: 80 }), yo),
        /por encima del mio/
    );

    // Caso valido.
    assert.equal(permisos.puedeActuarSobre(actorAlto, miembro({ id: 'b', posicion: 2 }), yo), null);
});
