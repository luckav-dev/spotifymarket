'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const logger = require('./logger');

const execFileAsync = promisify(execFile);
const RAIZ = path.resolve(__dirname, '..');
const FUENTE_RUTA = path.join(RAIZ, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const LOGO_RUTA = path.join(RAIZ, 'assets', 'brand', 'SpotifyMarket.png');
const ANCHO = 1600;
const PRODUCTOS_POR_PAGINA = 12;
const MAX_PAGINAS_DISCORD = 10;
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
const RENDERER_VERSION = 'html-chromium-cli-v3';

let recursosPromise = null;
let chromiumCache = undefined;

function escaparHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function dinero(valor, moneda = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: String(moneda || 'EUR').toUpperCase(),
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(valor || 0));
    } catch {
        return `${Number(valor || 0).toFixed(2)} ${String(moneda || 'EUR').toUpperCase()}`;
    }
}

function aDataUrl(buffer, mime) {
    if (!buffer) return '';
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

function dataUrlLocal(ruta, mime) {
    try {
        if (!fs.existsSync(ruta)) return '';
        return aDataUrl(fs.readFileSync(ruta), mime);
    } catch (error) {
        logger.warn('sellauth:stock-html', `No se pudo leer ${path.basename(ruta)}: ${error.message}`);
        return '';
    }
}

function recursosLocales() {
    if (!recursosPromise) {
        recursosPromise = Promise.resolve({
            font: dataUrlLocal(FUENTE_RUTA, 'font/ttf'),
            logo: dataUrlLocal(LOGO_RUTA, 'image/png')
        });
    }
    return recursosPromise;
}

async function descargarImagen(url) {
    if (!/^https:\/\//i.test(String(url || ''))) return '';
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 7000);
    timeout.unref?.();
    try {
        const respuesta = await fetch(url, {
            signal: controlador.signal,
            headers: { 'User-Agent': 'SpotifyMarketStockBoard/2.0' }
        });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const tipo = String(respuesta.headers.get('content-type') || 'image/png').split(';')[0];
        if (!tipo.startsWith('image/')) throw new Error(`tipo ${tipo}`);
        const declarado = Number(respuesta.headers.get('content-length') || 0);
        if (declarado > MAX_IMAGEN_BYTES) throw new Error('imagen demasiado grande');
        const buffer = Buffer.from(await respuesta.arrayBuffer());
        if (buffer.length > MAX_IMAGEN_BYTES) throw new Error('imagen demasiado grande');
        return aDataUrl(buffer, tipo);
    } catch (error) {
        logger.detalle(`Miniatura omitida (${String(url).slice(0, 80)}): ${error.message}`);
        return '';
    } finally {
        clearTimeout(timeout);
    }
}

async function hidratarImagenes(productos, concurrencia = 6) {
    const salida = productos.map(producto => ({ ...producto, imagenData: '' }));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrencia, Math.max(1, salida.length)) }, async () => {
        while (cursor < salida.length) {
            const indice = cursor++;
            salida[indice].imagenData = await descargarImagen(salida[indice].imagen);
        }
    });
    await Promise.all(workers);
    return salida;
}

function iniciales(nombre) {
    return String(nombre || 'SM')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(parte => parte[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'SM';
}

function gradienteProducto(producto) {
    const hash = crypto.createHash('sha1').update(String(producto.id || producto.nombre || '')).digest();
    const h1 = Math.round((hash[0] * 360) / 255);
    const h2 = (h1 + 35 + (hash[1] % 70)) % 360;
    return `linear-gradient(135deg,hsl(${h1} 62% 40%),hsl(${h2} 72% 24%))`;
}

function stockBadge(producto, umbral) {
    const stock = Number(producto.stock);
    if (stock < 0) return { clase: 'unlimited', texto: 'Unlimited' };
    if (stock <= umbral) return { clase: 'low', texto: `${stock} left` };
    return { clase: 'normal', texto: `${stock} in stock` };
}

function tarjeta(producto, umbral, logo) {
    const badge = stockBadge(producto, umbral);
    const fondo = gradienteProducto(producto);
    const imagen = producto.imagenData
        ? `<img src="${producto.imagenData}" alt="" />`
        : logo
            ? `<img class="fallback-logo" src="${logo}" alt="" />`
            : `<span>${escaparHtml(iniciales(producto.nombre))}</span>`;

    return `
      <article class="product-card">
        <div class="product-main">
          <div class="thumb" style="--fallback:${fondo}">${imagen}</div>
          <div class="product-copy">
            <div class="category">${escaparHtml(producto.categoria || 'Catalog')}</div>
            <div class="product-name">${escaparHtml(producto.nombre)}</div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="product-meta">
          <div>
            <div class="meta-label">Price</div>
            <div class="price">${escaparHtml(dinero(producto.precio, producto.moneda))}</div>
          </div>
          <div class="stock-badge ${badge.clase}"><span class="badge-dot"></span>${escaparHtml(badge.texto)}</div>
        </div>
      </article>`;
}

function alturaPagina(cantidad) {
    const filas = Math.max(1, Math.ceil(Math.max(1, cantidad) / 3));
    return 54 + 174 + 30 + 104 + 30 + (filas * 224) + (Math.max(0, filas - 1) * 19) + 28 + 58 + 38;
}

function htmlPagina(productosPagina, contexto) {
    const {
        todos,
        pagina,
        totalPaginas,
        title,
        subtitle,
        lowStockThreshold,
        updatedAt,
        font,
        logo
    } = contexto;

    const unidades = todos.filter(p => Number(p.stock) > 0).reduce((total, p) => total + Number(p.stock), 0);
    const infinitos = todos.some(p => Number(p.stock) < 0);
    const categorias = new Set(todos.map(p => String(p.categoria || '').trim()).filter(Boolean)).size;
    const cards = productosPagina.length
        ? productosPagina.map(p => tarjeta(p, lowStockThreshold, logo)).join('')
        : `<div class="empty"><strong>Stock is being prepared</strong><span>New availability will appear here automatically.</span></div>`;
    const paginaTexto = totalPaginas > 1 ? `Page ${pagina} / ${totalPaginas}` : 'Live inventory';
    const actualizado = new Date(updatedAt).toLocaleString('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const alto = alturaPagina(productosPagina.length);

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=${ANCHO},initial-scale=1" />
<style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block;}` : ''}
:root{--green:#1ed760;--text:#f6f8f7;--muted:#8b9890;--line:rgba(255,255,255,.085);--orange:#ffad4d}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:${ANCHO}px;height:${alto}px;overflow:hidden;background:#030504}body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text)}
.stock-board{width:${ANCHO}px;height:${alto}px;position:relative;overflow:hidden;background:radial-gradient(circle at 90% 3%,rgba(30,215,96,.15),transparent 26%),radial-gradient(circle at 2% 90%,rgba(30,215,96,.07),transparent 28%),linear-gradient(145deg,#07100a 0%,#050806 42%,#080b09 100%)}
.stock-board:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,rgba(255,255,255,.025),transparent 30%,transparent 72%,rgba(30,215,96,.025))}.inner{position:relative;padding:54px 58px 38px}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:42px}.eyebrow{display:inline-flex;align-items:center;gap:10px;padding:9px 15px;border-radius:999px;border:1px solid rgba(30,215,96,.3);background:rgba(30,215,96,.11);color:#7cf5a8;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 14px rgba(30,215,96,.75)}
h1{font-size:62px;line-height:.98;letter-spacing:-.045em;margin:18px 0 12px;font-weight:900}.green{color:var(--green)}.subtitle{font-size:20px;line-height:1.45;color:#a4afa8;max-width:860px}.brand{display:flex;align-items:center;gap:17px;padding:15px 19px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.025);min-width:290px}.brand-logo{width:68px;height:68px;border-radius:20px;object-fit:contain;background:rgba(30,215,96,.08);padding:6px}.brand-fallback{width:68px;height:68px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-weight:950;font-size:34px}.brand small{display:block;color:#728078;font-size:11px;font-weight:750;letter-spacing:.16em;text-transform:uppercase;margin-bottom:5px}.brand strong{font-size:25px;letter-spacing:-.025em}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:31px 0 30px}.stat{border:1px solid var(--line);background:rgba(255,255,255,.028);border-radius:20px;padding:20px 22px}.stat-value{font-size:32px;font-weight:900;letter-spacing:-.04em;line-height:1;margin-bottom:8px}.stat-label{font-size:11px;color:#758279;letter-spacing:.16em;text-transform:uppercase;font-weight:750}
.products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:19px}.product-card{min-height:224px;border-radius:24px;padding:19px;border:1px solid var(--line);background:radial-gradient(circle at 100% 0,rgba(30,215,96,.07),transparent 34%),linear-gradient(180deg,rgba(15,20,17,.97),rgba(9,13,10,.98));box-shadow:0 18px 35px rgba(0,0,0,.22)}.product-main{display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:start}.thumb{width:90px;height:90px;border-radius:20px;overflow:hidden;display:grid;place-items:center;background:var(--fallback);border:1px solid rgba(255,255,255,.09);font-size:25px;font-weight:900}.thumb img{width:100%;height:100%;object-fit:cover}.thumb img.fallback-logo{object-fit:contain;padding:12px;background:#090d0a}.category{color:#7f8c84;font-size:11px;line-height:1.2;font-weight:750;letter-spacing:.14em;text-transform:uppercase;margin:5px 0 9px}.product-name{font-size:21px;line-height:1.12;letter-spacing:-.025em;font-weight:850;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.divider{height:1px;background:var(--line);margin:17px 0 15px}.product-meta{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.meta-label{color:#748178;font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase;margin-bottom:7px}.price{font-size:24px;font-weight:900;letter-spacing:-.035em}.stock-badge{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:10px 13px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.badge-dot{width:7px;height:7px;border-radius:50%;background:currentColor}.stock-badge.normal{color:#6ff19d;background:rgba(30,215,96,.11);border:1px solid rgba(30,215,96,.27)}.stock-badge.low{color:#ffc370;background:rgba(255,173,77,.10);border:1px solid rgba(255,173,77,.28)}.stock-badge.unlimited{color:#d9e0dc;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.13)}
.empty{grid-column:1/-1;min-height:224px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:26px;background:rgba(255,255,255,.025);gap:10px}.empty strong{font-size:30px}.empty span{font-size:17px;color:var(--muted)}
.footer{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:28px;padding-top:20px;border-top:1px solid var(--line);color:#89958d;font-size:13px}.footer strong{color:#e7ece9}.live{display:flex;align-items:center;gap:10px}.live-dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(30,215,96,.11)}.page{color:#70e99b;font-weight:750}
</style></head><body><section class="stock-board"><div class="inner">
<header class="header"><div><div class="eyebrow"><span class="eyebrow-dot"></span>Live catalog</div><h1><span class="green">LIVE</span> STOCK</h1><div class="subtitle">${escaparHtml(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div></div><div class="brand">${logo ? `<img class="brand-logo" src="${logo}" alt="" />` : `<div class="brand-fallback">SM</div>`}<div><small>Spotify Market</small><strong>${escaparHtml(title || 'Stock board')}</strong></div></div></header>
<div class="stats"><div class="stat"><div class="stat-value">${todos.length}</div><div class="stat-label">Products live</div></div><div class="stat"><div class="stat-value">${infinitos ? `${unidades}+` : unidades}</div><div class="stat-label">Units ready</div></div><div class="stat"><div class="stat-value">${categorias}</div><div class="stat-label">Categories</div></div></div><main class="products">${cards}</main>
<footer class="footer"><div><strong>Spotify Market</strong> / SellAuth live stock board</div><div class="live"><span class="live-dot"></span><span class="page">${paginaTexto}</span><span>·</span><span>${escaparHtml(actualizado)}</span></div></footer></div></section></body></html>`;
}

function esEjecutable(ruta) {
    if (!ruta) return false;
    try {
        fs.accessSync(ruta, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function resolverChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidatos = [
        process.env.CHROMIUM_PATH?.trim(),
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium'
    ].filter(Boolean);
    for (const candidato of candidatos) {
        if (esEjecutable(candidato)) {
            chromiumCache = candidato;
            return chromiumCache;
        }
    }
    for (const nombre of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
        try {
            const salida = execFileSync('which', [nombre], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (salida && esEjecutable(salida)) {
                chromiumCache = salida;
                return chromiumCache;
            }
        } catch {
            // Sigue buscando.
        }
    }
    chromiumCache = '';
    return chromiumCache;
}

async function renderizar(html, alto) {
    const chromium = resolverChromium();
    if (!chromium) {
        throw new Error('No hay Chromium instalado. Instala `chromium` en la VPS o define CHROMIUM_PATH con la ruta del navegador.');
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-stock-'));
    const htmlPath = path.join(dir, 'stock.html');
    const pngPath = path.join(dir, 'stock.png');
    fs.writeFileSync(htmlPath, html, 'utf8');
    try {
        await execFileAsync(chromium, [
            '--headless', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars',
            '--run-all-compositor-stages-before-draw', '--force-device-scale-factor=1', `--window-size=${ANCHO},${alto}`, `--screenshot=${pngPath}`, `file://${htmlPath}`
        ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } });
        if (!fs.existsSync(pngPath)) throw new Error('Chromium no genero el PNG del stock.');
        const buffer = fs.readFileSync(pngPath);
        if (buffer.length < 10000) throw new Error('Chromium genero una imagen de stock vacia o invalida.');
        return buffer;
    } catch (error) {
        const detalle = error.stderr ? String(error.stderr).trim().slice(-500) : error.message;
        throw new Error(`Chromium no pudo renderizar el stock HTML: ${detalle}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function dividir(lista, tamano) {
    const paginas = [];
    for (let i = 0; i < lista.length; i += tamano) paginas.push(lista.slice(i, i + tamano));
    return paginas.length ? paginas : [[]];
}

function nombreArchivoStock(pagina = 1, total = 1) {
    return total > 1 ? `spotify-market-live-stock-${String(pagina).padStart(2, '0')}.png` : 'spotify-market-live-stock.png';
}

async function generarPanelesStock(productos, opciones = {}) {
    const disponibles = productos
        .filter(producto => producto?.visible && Number(producto.stock) !== 0)
        .sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const porPagina = Math.min(Math.max(Number(opciones.productsPerPage) || PRODUCTOS_POR_PAGINA, 6), 12);
    const maxPaginas = Math.min(Math.max(Number(opciones.maxPages) || 3, 1), MAX_PAGINAS_DISCORD);
    const limite = porPagina * maxPaginas;
    const visibles = disponibles.slice(0, limite);
    if (disponibles.length > limite) logger.warn('sellauth:stock-html', `${disponibles.length - limite} productos no caben en las ${maxPaginas} paginas configuradas.`);
    const [recursos, hidratados] = await Promise.all([recursosLocales(), hidratarImagenes(visibles)]);
    const paginas = dividir(hidratados, porPagina);
    const updatedAt = Number(opciones.updatedAt) || Date.now();
    const totalPaginas = paginas.length;
    const resultados = [];
    for (let i = 0; i < paginas.length; i += 1) {
        const html = htmlPagina(paginas[i], {
            todos: hidratados, pagina: i + 1, totalPaginas,
            title: opciones.title || 'Stock board',
            subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.',
            lowStockThreshold: Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3,
            updatedAt, ...recursos
        });
        resultados.push({ pagina: i + 1, totalPaginas, nombre: nombreArchivoStock(i + 1, totalPaginas), buffer: await renderizar(html, alturaPagina(paginas[i].length)) });
    }
    return resultados;
}

async function cerrar() {
    // Chromium se lanza como proceso puntual por render; no queda navegador residente.
}

function diagnostico() {
    const chromium = resolverChromium();
    return { renderer: RENDERER_VERSION, chromiumPath: chromium || '', available: Boolean(chromium) };
}

module.exports = { ANCHO, PRODUCTOS_POR_PAGINA, RENDERER_VERSION, generarPanelesStock, nombreArchivoStock, diagnostico, cerrar };
