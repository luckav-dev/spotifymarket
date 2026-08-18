'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ui = require('../utils/ui');

const emojis = { rol: () => '', get: () => '' };

test('truncar no parte una palabra por la mitad', () => {
    const salida = ui.truncar('palabras muy largas encadenadas aqui', 20);
    assert.ok(salida.length <= 20);
    assert.ok(salida.endsWith('…'));
    assert.ok(!salida.includes('  '));
});

test('truncar deja intacto lo que ya cabe', () => {
    assert.equal(ui.truncar('corto', 20), 'corto');
});

test('plano escapa el markdown que viene del usuario', () => {
    assert.equal(ui.plano('**hola** _mundo_'), '\\*\\*hola\\*\\* \\_mundo\\_');
});

test('dato neutraliza las comillas invertidas para no romper el inline', () => {
    assert.ok(!ui.dato('a`b').includes('a`b'));
    assert.equal(ui.dato(''), '`—`');
});

test('cita prefija todas las lineas, no solo la primera', () => {
    assert.equal(ui.cita('a\nb'), '> a\n> b');
});

test('duracion se queda en las dos unidades mas significativas', () => {
    assert.equal(ui.duracion(0), '0 s');
    assert.equal(ui.duracion(90_000), '1 min 30 s');
    assert.equal(ui.duracion(86_400_000 + 3_600_000 + 60_000), '1 d 1 h');
});

test('barra no se sale del ancho pedido ni con valores fuera de rango', () => {
    assert.equal(ui.barra(5, 10, 10).length, 10);
    assert.equal(ui.barra(50, 10, 10), '█'.repeat(10));
    assert.equal(ui.barra(-5, 10, 10), '░'.repeat(10));
    assert.equal(ui.barra(1, 0, 8).length, 8);
});

test('el paginador desactiva los extremos', () => {
    const primera = ui.paginador(emojis, { dominio: 'x', accion: 'p', pagina: 0, total: 3 }).toJSON();
    assert.equal(primera.components[0].disabled, true);
    assert.equal(primera.components[2].disabled, undefined);

    const ultima = ui.paginador(emojis, { dominio: 'x', accion: 'p', pagina: 2, total: 3 }).toJSON();
    assert.equal(ultima.components[2].disabled, true);
});

test('panel se construye sin accent color', () => {
    const json = ui.panel(emojis, { titulo: 'T', cuerpo: ['a'], pie: 'p' }).toJSON();
    assert.equal(json.accent_color, undefined);
    assert.ok(json.components.length > 1);
});
