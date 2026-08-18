'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Database = require('../utils/jsonDatabase');

const DIR = path.resolve(__dirname, '..', 'database');

function limpiar(nombre) {
    for (const sufijo of ['', '.tmp']) {
        const ruta = path.join(DIR, `${nombre}.json${sufijo}`);
        if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
    }
}

test('completar rellena claves anidadas nuevas sin pisar los datos guardados', () => {
    const nombre = `prueba-completar-${process.pid}`;
    limpiar(nombre);

    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(
        path.join(DIR, `${nombre}.json`),
        JSON.stringify({ contador: 7, ajustes: { a: 1 } }),
        'utf8'
    );

    const db = new Database(nombre, { contador: 0, ajustes: { a: 0, b: 2 }, nuevo: [] });

    assert.equal(db.data.contador, 7, 'no debe pisar un valor existente');
    assert.equal(db.data.ajustes.a, 1);
    assert.equal(db.data.ajustes.b, 2, 'debe anadir la clave anidada nueva');
    assert.deepEqual(db.data.nuevo, []);

    limpiar(nombre);
});

test('la misma instancia se comparte entre modulos que piden el mismo dominio', () => {
    const nombre = `prueba-singleton-${process.pid}`;
    limpiar(nombre);

    const a = new Database(nombre, { valor: 0 });
    const b = new Database(nombre, { valor: 0 });
    a.data.valor = 42;

    assert.equal(b.data.valor, 42, 'dos modulos no pueden ver estados distintos');
    assert.equal(a, b);

    limpiar(nombre);
});

test('un JSON corrupto se aparta y la base arranca vacia', () => {
    const nombre = `prueba-corrupto-${process.pid}`;
    limpiar(nombre);

    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${nombre}.json`), '{ esto no es json', 'utf8');

    const db = new Database(nombre, { valor: 'inicial' });
    assert.equal(db.data.valor, 'inicial');

    const apartados = fs.readdirSync(DIR).filter(f => f.startsWith(`${nombre}.json.corrupto-`));
    assert.equal(apartados.length, 1, 'el archivo roto tiene que conservarse para poder mirarlo');

    for (const archivo of apartados) fs.unlinkSync(path.join(DIR, archivo));
    limpiar(nombre);
});
