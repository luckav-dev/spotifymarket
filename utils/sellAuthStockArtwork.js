'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const logger = require('./logger');
const arte = require('./sellAuthArtwork');

const RAIZ = path.resolve(__dirname, '..');
const ANCHO = 1600;
const FUENTE_RUTA = path.join(RAIZ, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const FONDO_RUTA = path.join(RAIZ, 'assets', 'brand', 'banner.png');
const LOGO_RUTA = path.join(RAIZ, 'assets', 'brand', 'SpotifyMarket.png');

let fuenteRegistrada = false;

function prepararFuente() {
    if (fuenteRegistrada) return;
    fuenteRegistrada = true;
    try {
        if (fs.existsSync(FUENTE_RUTA)) GlobalFonts.registerFromPath(FUENTE_RUTA);
    } catch (error) {
        logger.warn('sellauth:stock-art', `No se pudo registrar Montserrat: ${error.message}`);
    }
}

function fuente(peso, tamano) {
    prepararFuente();
    return `${peso} ${tamano}px "Montserrat", "Segoe UI", sans-serif`;
}

async function cargarImagen(origen) {
    if (!origen) return null;
    try {
        if (/^https:\/\//i.test(origen)) {
            const controlador = new AbortController();
            const timeout = setTimeout(() => controlador.abort(), 7000);
            timeout.unref?.();
            const respuesta = await fetch(origen, { signal: controlador.signal });
            clearTimeout(timeout);
            if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
            return loadImage(Buffer.from(await respuesta.arrayBuffer()));
        }
        return loadImage(origen);
    } catch (error) {
        logger.warn('sellauth:stock-art', `No se pudo cargar '${origen}': ${error.message}`);
        return null;
    }
}

function cubrir(ctx, imagen, x, y, ancho, alto) {
    const escala = Math.max(ancho / imagen.width, alto / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    ctx.drawImage(imagen, x + (ancho - w) / 2, y + (alto - h) / 2, w, h);
}

function contener(ctx, imagen, x, y, ancho, alto) {
    const escala = Math.min(ancho / imagen.width, alto / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    ctx.drawImage(imagen, x + (ancho - w) / 2, y + (alto - h) / 2, w, h);
}

function rect(ctx, x, y, ancho, alto, radio, color) {
    ctx.beginPath();
    ctx.roundRect(x, y, ancho, alto, radio);
    ctx.fillStyle = color;
    ctx.fill();
}

function lineas(ctx, texto, maxAncho, maxLineas = 2) {
    const palabras = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
    const salida = [];
    let actual = '';
    for (const palabra of palabras) {
        const candidata = actual ? `${actual} ${palabra}` : palabra;
        if (ctx.measureText(candidata).width <= maxAncho) {
            actual = candidata;
            continue;
        }
        if (actual) salida.push(actual);
        actual = palabra;
        if (salida.length === maxLineas - 1) break;
    }
    if (actual && salida.length < maxLineas) salida.push(actual);
    if (salida.join(' ').length < String(texto).trim().length && salida.length) {
        let ultima = salida.at(-1);
        while (ultima.length > 1 && ctx.measureText(`${ultima}...`).width > maxAncho) ultima = ultima.slice(0, -1);
        salida[salida.length - 1] = `${ultima.trim()}...`;
    }
    return salida;
}

function etiqueta(ctx, texto, x, y) {
    ctx.font = fuente(850, 20);
    ctx.letterSpacing = '1.8px';
    const ancho = ctx.measureText(texto).width + 38;
    rect(ctx, x, y, ancho, 44, 22, '#1ed760');
    ctx.fillStyle = '#061009';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x + ancho / 2, y + 23);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
}

function stat(ctx, x, y, titulo, valor) {
    rect(ctx, x, y, 205, 76, 20, 'rgba(255,255,255,.05)');
    ctx.strokeStyle = 'rgba(255,255,255,.085)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, 205, 76, 20);
    ctx.stroke();
    ctx.font = fuente(850, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(valor), x + 17, y + 32);
    ctx.font = fuente(650, 12);
    ctx.fillStyle = '#85948a';
    ctx.letterSpacing = '1px';
    ctx.fillText(titulo.toUpperCase(), x + 17, y + 57);
    ctx.letterSpacing = '0px';
}

function badgeStock(ctx, xDerecha, y, producto, umbralBajo) {
    const infinito = producto.stock < 0;
    const bajo = !infinito && producto.stock <= umbralBajo;
    const texto = infinito ? 'IN STOCK · ∞' : `${producto.stock} IN STOCK`;
    const color = bajo ? '#ffb454' : '#1ed760';
    const fondo = bajo ? 'rgba(255,180,84,.13)' : 'rgba(30,215,96,.12)';
    ctx.font = fuente(850, 13);
    ctx.letterSpacing = '.7px';
    const ancho = Math.max(108, ctx.measureText(texto).width + 28);
    rect(ctx, xDerecha - ancho, y, ancho, 34, 17, fondo);
    ctx.strokeStyle = bajo ? 'rgba(255,180,84,.35)' : 'rgba(30,215,96,.32)';
    ctx.beginPath();
    ctx.roundRect(xDerecha - ancho, y, ancho, 34, 17);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, xDerecha - ancho / 2, y + 18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
}

async function cargarMiniaturas(productos, limite = 8) {
    const resultado = new Array(productos.length).fill(null);
    let indice = 0;
    const workers = Array.from({ length: Math.min(limite, productos.length) }, async () => {
        while (indice < productos.length) {
            const actual = indice++;
            resultado[actual] = await cargarImagen(productos[actual].imagen);
        }
    });
    await Promise.all(workers);
    return resultado;
}

async function generarPanelStock(productos, opciones = {}) {
    const disponibles = productos
        .filter(producto => producto?.visible && Number(producto.stock) !== 0)
        .sort((a, b) => String(a.categoria).localeCompare(String(b.categoria)) || String(a.nombre).localeCompare(String(b.nombre)));

    const columnas = disponibles.length <= 2 ? Math.max(1, disponibles.length) : disponibles.length <= 6 ? 3 : 4;
    const margen = 58;
    const gap = 22;
    const cabecera = 322;
    const pie = 104;
    const altoCard = 232;
    const filas = Math.max(1, Math.ceil(disponibles.length / Math.max(1, columnas)));
    const alto = cabecera + filas * altoCard + Math.max(0, filas - 1) * gap + pie + 28;
    const canvas = createCanvas(ANCHO, alto);
    const ctx = canvas.getContext('2d');

    const gradiente = ctx.createLinearGradient(0, 0, ANCHO, alto);
    gradiente.addColorStop(0, '#050806');
    gradiente.addColorStop(.5, '#07110b');
    gradiente.addColorStop(1, '#090b0a');
    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, ANCHO, alto);

    const fondo = await cargarImagen(FONDO_RUTA);
    if (fondo) {
        ctx.save();
        ctx.globalAlpha = .05;
        ctx.filter = 'blur(8px)';
        cubrir(ctx, fondo, -20, -20, ANCHO + 40, alto + 40);
        ctx.restore();
    }

    const glow = ctx.createRadialGradient(1280, 90, 20, 1280, 90, 650);
    glow.addColorStop(0, 'rgba(30,215,96,.20)');
    glow.addColorStop(1, 'rgba(30,215,96,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ANCHO, 720);

    const logo = await cargarImagen(LOGO_RUTA);
    if (logo) contener(ctx, logo, 1290, 46, 242, 118);

    etiqueta(ctx, 'LIVE CATALOG', margen, 52);
    ctx.font = fuente(880, 62);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(opciones.title || 'PRODUCT STOCK'), margen, 148);
    ctx.font = fuente(550, 22);
    ctx.fillStyle = '#a6b2aa';
    ctx.fillText(String(opciones.subtitle || 'Available products, synced automatically from SellAuth.').slice(0, 105), margen, 190);

    const unidades = disponibles.filter(p => p.stock > 0).reduce((total, p) => total + Number(p.stock), 0);
    const infinitos = disponibles.filter(p => p.stock < 0).length;
    const categorias = new Set(disponibles.map(p => p.categoria).filter(Boolean)).size;
    stat(ctx, margen, 222, 'products live', disponibles.length);
    stat(ctx, margen + 220, 222, 'units ready', infinitos ? `${unidades}+` : unidades);
    stat(ctx, margen + 440, 222, 'categories', categorias);

    ctx.font = fuente(650, 14);
    ctx.fillStyle = '#728077';
    ctx.textAlign = 'right';
    ctx.fillText('REAL-TIME INVENTORY BOARD', ANCHO - margen, 278);
    ctx.textAlign = 'left';

    if (!disponibles.length) {
        const y = cabecera + 32;
        rect(ctx, margen, y, ANCHO - margen * 2, 232, 28, 'rgba(255,255,255,.04)');
        ctx.strokeStyle = 'rgba(255,255,255,.09)';
        ctx.beginPath();
        ctx.roundRect(margen, y, ANCHO - margen * 2, 232, 28);
        ctx.stroke();
        ctx.font = fuente(850, 34);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('Stock is being prepared', ANCHO / 2, y + 99);
        ctx.font = fuente(550, 18);
        ctx.fillStyle = '#849087';
        ctx.fillText('New availability will appear here automatically.', ANCHO / 2, y + 139);
        ctx.textAlign = 'left';
    } else {
        const anchoCard = (ANCHO - margen * 2 - gap * (columnas - 1)) / columnas;
        const miniaturas = await cargarMiniaturas(disponibles);
        const umbral = Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3;

        disponibles.forEach((producto, i) => {
            const fila = Math.floor(i / columnas);
            const columna = i % columnas;
            const x = margen + columna * (anchoCard + gap);
            const y = cabecera + fila * (altoCard + gap);

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,.34)';
            ctx.shadowBlur = 24;
            rect(ctx, x, y, anchoCard, altoCard, 26, 'rgba(13,18,15,.91)');
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,.095)';
            ctx.beginPath();
            ctx.roundRect(x, y, anchoCard, altoCard, 26);
            ctx.stroke();

            const thumb = 94;
            const tx = x + 20;
            const ty = y + 21;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(tx, ty, thumb, thumb, 20);
            ctx.clip();
            ctx.fillStyle = '#090d0a';
            ctx.fillRect(tx, ty, thumb, thumb);
            if (miniaturas[i]) cubrir(ctx, miniaturas[i], tx, ty, thumb, thumb);
            else if (logo) contener(ctx, logo, tx + 12, ty + 12, thumb - 24, thumb - 24);
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,.10)';
            ctx.beginPath();
            ctx.roundRect(tx, ty, thumb, thumb, 20);
            ctx.stroke();

            const contenidoX = tx + thumb + 18;
            const contenidoW = anchoCard - (contenidoX - x) - 18;
            ctx.font = fuente(850, 19);
            ctx.fillStyle = '#fff';
            lineas(ctx, producto.nombre, contenidoW, 2).forEach((linea, j) => ctx.fillText(linea, contenidoX, y + 48 + j * 25));
            ctx.font = fuente(650, 12);
            ctx.fillStyle = '#7f8f84';
            ctx.letterSpacing = '.8px';
            ctx.fillText(String(producto.categoria || 'CATALOG').toUpperCase().slice(0, 30), contenidoX, y + 105);
            ctx.letterSpacing = '0px';

            ctx.fillStyle = 'rgba(255,255,255,.08)';
            ctx.fillRect(x + 20, y + 132, anchoCard - 40, 1);
            ctx.font = fuente(600, 12);
            ctx.fillStyle = '#7f8f84';
            ctx.fillText('PRICE', x + 20, y + 165);
            ctx.font = fuente(850, 22);
            ctx.fillStyle = '#fff';
            ctx.fillText(arte.precio(producto.precio, producto.moneda), x + 20, y + 197);
            badgeStock(ctx, x + anchoCard - 20, y + 164, producto, umbral);
        });
    }

    const pieY = alto - pie;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(margen, pieY, ANCHO - margen * 2, 1);
    ctx.font = fuente(650, 14);
    ctx.fillStyle = '#8a988f';
    ctx.letterSpacing = '1px';
    ctx.fillText('SPOTIFY MARKET  /  SELLAUTH LIVE STOCK', margen, pieY + 43);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#607067';
    const actualizado = new Date(opciones.updatedAt || Date.now()).toLocaleString('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    ctx.fillText(`UPDATED ${actualizado.toUpperCase()} · AUTO-SYNC`, ANCHO - margen, pieY + 43);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

function nombreArchivoStock() {
    return 'spotify-market-live-stock.png';
}

module.exports = { generarPanelStock, nombreArchivoStock, ANCHO };
