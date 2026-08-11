'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const validacionConfig = require('../utils/validacionConfig');

const RAIZ = path.resolve(__dirname, '..');
const CARPETAS_JS = ['commands', 'events', 'modules', 'utils', 'scripts'];

function archivosDe(dir, filtro = () => true) {
    if (!fs.existsSync(dir)) return [];
    const encontrados = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, entrada.name);
        if (entrada.isDirectory()) encontrados.push(...archivosDe(ruta, filtro));
        else if (filtro(ruta)) encontrados.push(ruta);
    }
    return encontrados;
}

function fallo(mensaje) {
    console.error(`x ${mensaje}`);
    process.exitCode = 1;
}

const js = [
    path.join(RAIZ, 'index.js'),
    ...CARPETAS_JS.flatMap(dir => archivosDe(path.join(RAIZ, dir), ruta => ruta.endsWith('.js')))
];
for (const archivo of js) {
    const resultado = spawnSync(process.execPath, ['--check', archivo], { encoding: 'utf8' });
    if (resultado.status !== 0) fallo(`${path.relative(RAIZ, archivo)} no pasa node --check\n${resultado.stderr}`);
}
console.log(`ok sintaxis: ${js.length} archivos`);

const configs = archivosDe(path.join(RAIZ, 'config'), ruta => ruta.endsWith('.json'));
for (const archivo of configs) {
    try {
        JSON.parse(fs.readFileSync(archivo, 'utf8'));
    } catch (error) {
        fallo(`${path.relative(RAIZ, archivo)} no es JSON valido: ${error.message}`);
    }
}
console.log(`ok configuracion: ${configs.length} archivos`);

const revisiones = validacionConfig.validarTodo();
for (const revision of revisiones) {
    for (const error of revision.errores) fallo(`config/${revision.nombre}.json: ${error}`);
}
const avisosConfig = revisiones.reduce((total, revision) => total + revision.avisos.length, 0);
console.log(`ok esquemas: ${revisiones.length} configuraciones validadas · ${avisosConfig} aviso(s) no bloqueante(s)`);

const nombresEmoji = new Set(
    fs.readdirSync(path.join(RAIZ, 'emojis'))
        .filter(nombre => /\.(png|jpe?g|gif)$/i.test(nombre))
        .map(nombre => path.parse(nombre).name)
);
const cacheEmoji = JSON.parse(fs.readFileSync(path.join(RAIZ, 'emojis.json'), 'utf8'));
const rolesEmoji = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'emojis.json'), 'utf8')).roles;

for (const [rol, nombre] of Object.entries(rolesEmoji)) {
    if (!nombresEmoji.has(nombre)) fallo(`el rol de emoji '${rol}' apunta a '${nombre}', pero no existe su imagen`);
}
for (const nombre of nombresEmoji) {
    if (!cacheEmoji[nombre]) fallo(`emojis/${nombre} no tiene entrada en emojis.json`);
}
console.log(`ok emojis: ${nombresEmoji.size} imagenes, ${Object.keys(rolesEmoji).length} roles`);

for (const archivo of js) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    if (archivo.endsWith(path.join('scripts', 'check.js'))) continue;
    if (/\.setAccentColor\s*\(/.test(contenido)) {
        fallo(`${path.relative(RAIZ, archivo)} usa setAccentColor`);
    }
    if (/\bEmbedBuilder\b|\.setColor\s*\(/.test(contenido)) {
        fallo(`${path.relative(RAIZ, archivo)} usa embeds o colores heredados en vez de Components V2`);
    }
}
console.log('ok lenguaje visual: Components V2 sin embeds ni accent color');

const comandos = archivosDe(path.join(RAIZ, 'commands'), ruta => ruta.endsWith('.js'));
const nombres = new Set();
const metadataNoIngles = /\b(muestra|usuario|canal|motivo|configura|gestiona|envia|envía|anade|añade|retira|borra|selecciona|categoria|categoría|funcion|función|aviso|informacion|información)\b/i;
for (const archivo of comandos) {
    const comando = require(archivo);
    if (!comando?.data || typeof comando.execute !== 'function') {
        fallo(`${path.relative(RAIZ, archivo)} no exporta data y execute`);
        continue;
    }

    const datos = comando.data.toJSON();
    if (nombres.has(datos.name)) fallo(`el comando /${datos.name} esta duplicado`);
    nombres.add(datos.name);

    const revisarMetadata = (opcion, ruta = datos.name) => {
        if (metadataNoIngles.test(opcion.description ?? '')) {
            fallo(`${path.relative(RAIZ, archivo)} conserva metadata no inglesa en '${ruta}': ${opcion.description}`);
        }
        for (const hija of opcion.options ?? []) revisarMetadata(hija, `${ruta} ${hija.name}`);
    };
    revisarMetadata(datos);
}
console.log(`ok comandos: ${nombres.size} unicos`);

if (process.exitCode) process.exit(process.exitCode);
console.log('Todo correcto.');
