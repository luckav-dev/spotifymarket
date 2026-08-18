'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const logger = require('./logger');

const ROOT = path.resolve(__dirname, '..');
const FONT_PATH = path.join(ROOT, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const LOGO_PATH = path.join(ROOT, 'assets', 'brand', 'SpotifyMarket.png');
const ANCHO = 2400;
const PRODUCTOS_POR_PAGINA = 60;
const RENDERER_VERSION = 'html-chrome-cli-v15-prefetched-assets';
const RENDER_TIMEOUT_MS = 12000;
const IMAGE_TIMEOUT_MS = 2600;
const IMAGE_MAX_BYTES = 420 * 1024;
const IMAGE_CONCURRENCY = 8;

let chromiumCache;

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function money(value, currency = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency', currency: String(currency || 'EUR').toUpperCase(),
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(Number(value || 0));
    } catch {
        return `${Number(value || 0).toFixed(2)} ${String(currency || 'EUR').toUpperCase()}`;
    }
}

function fileUrl(file) {
    try { return fs.existsSync(file) ? pathToFileURL(file).href : ''; }
    catch { return ''; }
}

function initials(name) {
    return String(name || 'SM').split(/\s+/).filter(Boolean).slice(0, 2)
        .map(x => x[0]).join('').toUpperCase().slice(0, 2) || 'SM';
}

function gradient(product) {
    const hash = crypto.createHash('sha1').update(String(product.id || product.nombre || '')).digest();
    const a = Math.round(hash[0] * 360 / 255);
    const b = (a + 44 + hash[1] % 60) % 360;
    return `linear-gradient(135deg,hsl(${a} 64% 42%),hsl(${b} 70% 22%))`;
}

function badge(product, low) {
    const stock = Number(product.stock);
    if (stock < 0) return { cls: 'unlimited', top: 'AVAILABLE', num: '∞', label: 'UNLIMITED' };
    if (stock <= low) return { cls: 'low', top: 'LOW STOCK', num: String(stock), label: 'READY NOW' };
    return { cls: 'normal', top: 'AVAILABLE', num: String(stock), label: 'READY NOW' };
}

function layoutFor(count) {
    const total = Math.max(1, Number(count) || 1);
    if (total <= 15) return { width: 2200, columns: 5, gap: 18, cardHeight: 252, paddingX: 46, paddingTop: 34, thumb: 88, hero: 82, subtitle: 18, title: 22, price: 31, stock: 31, radius: 22, cardPadding: 16, compact: false, stat: 43, footer: 13, headerHeight: 205, statsHeight: 104 };
    if (total <= 25) return { width: 2300, columns: 5, gap: 16, cardHeight: 225, paddingX: 38, paddingTop: 30, thumb: 76, hero: 72, subtitle: 16, title: 19, price: 27, stock: 27, radius: 20, cardPadding: 14, compact: false, stat: 37, footer: 12, headerHeight: 185, statsHeight: 92 };
    if (total <= 42) return { width: 2300, columns: 6, gap: 13, cardHeight: 190, paddingX: 32, paddingTop: 26, thumb: 62, hero: 62, subtitle: 14, title: 16, price: 23, stock: 23, radius: 18, cardPadding: 12, compact: true, stat: 31, footer: 11, headerHeight: 166, statsHeight: 80 };
    if (total <= 60) return { width: 2400, columns: 6, gap: 11, cardHeight: 174, paddingX: 28, paddingTop: 23, thumb: 54, hero: 56, subtitle: 13, title: 14, price: 20, stock: 20, radius: 16, cardPadding: 10, compact: true, stat: 28, footer: 10, headerHeight: 152, statsHeight: 72 };
    return { width: 2550, columns: 7, gap: 10, cardHeight: 160, paddingX: 26, paddingTop: 21, thumb: 50, hero: 52, subtitle: 12, title: 13, price: 18, stock: 18, radius: 15, cardPadding: 9, compact: true, stat: 26, footer: 10, headerHeight: 144, statsHeight: 68 };
}

function pageHeight(count, layout) {
    const rows = Math.max(1, Math.ceil(Math.max(1, count) / layout.columns));
    const cardsHeight = rows * layout.cardHeight + Math.max(0, rows - 1) * layout.gap;
    const statsMargins = layout.compact ? 28 : 38;
    const footerReserve = layout.compact ? 64 : 76;
    return layout.paddingTop + layout.headerHeight + statsMargins + layout.statsHeight + cardsHeight + footerReserve + 32;
}

async function readLimitedImage(response, controller) {
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return '';
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return '';
    if (!response.body?.getReader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > IMAGE_MAX_BYTES) return '';
        return `data:${type};base64,${buffer.toString('base64')}`;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > IMAGE_MAX_BYTES) {
            controller.abort();
            return '';
        }
        chunks.push(Buffer.from(value));
    }
    const buffer = Buffer.concat(chunks);
    return buffer.length ? `data:${type};base64,${buffer.toString('base64')}` : '';
}

async function downloadImage(url) {
    if (!/^https:\/\//i.test(String(url || ''))) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    timer.unref?.();
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' }
        });
        return await readLimitedImage(response, controller);
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}

async function mapLimit(items, limit, fn) {
    const result = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            result[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return result;
}

async function prepareImages(products) {
    const started = Date.now();
    const urls = [...new Set(products.map(p => String(p.imagen || '')).filter(url => /^https:\/\//i.test(url)))];
    const downloaded = await mapLimit(urls, IMAGE_CONCURRENCY, downloadImage);
    const map = new Map(urls.map((url, index) => [url, downloaded[index] || '']));
    const prepared = products.map(p => ({ ...p, imagenRender: map.get(String(p.imagen || '')) || '' }));
    logger.detalle(`Stock assets: ${downloaded.filter(Boolean).length}/${urls.length} imagen(es) precargadas en ${Date.now() - started} ms`);
    return prepared;
}

function imageMarkup(product, logo) {
    const local = /^data:image\//i.test(String(product.imagenRender || '')) ? product.imagenRender : '';
    const fallback = logo ? `<img src="${logo}" alt="">` : `<b>${esc(initials(product.nombre))}</b>`;
    return `<div class="fallback">${fallback}</div>${local ? `<img class="remote" src="${local}" alt="">` : ''}`;
}

function statIcon(type) {
    const paths = {
        products: '<path d="M7 7.7 16 3l9 4.7v10.6L16 23l-9-4.7Z"/><path d="m7 7.7 9 4.7 9-4.7M16 12.4V23"/>',
        units: '<path d="M5 9.5 16 4l11 5.5v13L16 28 5 22.5Z"/><path d="m5 9.5 11 5.5 11-5.5"/>',
        categories: '<path d="M5 15.2 15.2 5H26v10.8L15.8 26 5 15.2Z"/><circle cx="21" cy="10" r="2"/>',
        low: '<path d="M16 4 29 27H3L16 4Z"/><path d="M16 11v8M16 23h.01"/>'
    };
    return `<svg viewBox="0 0 32 32" aria-hidden="true">${paths[type] || paths.products}</svg>`;
}

function productCard(product, low, logo, layout) {
    const state = badge(product, low);
    const caption = layout.compact ? '' : '<div class="caption">Instant digital delivery</div>';
    return `<article class="card ${state.cls}"><div class="card-glow"></div><div class="accent"></div>
      <div class="topline"><span class="cat">${esc(product.categoria || 'Catalog')}</span><span class="avail"><i></i>${state.top}</span></div>
      <div class="product-row"><div class="thumb" style="--fallback:${gradient(product)}">${imageMarkup(product, logo)}</div><div class="product-copy"><div class="name">${esc(product.nombre)}</div>${caption}</div></div>
      <div class="info-panel"><div class="info-cell"><span class="info-label">PRICE</span><strong class="price-value">${esc(money(product.precio, product.moneda))}</strong></div><div class="info-divider"></div><div class="info-cell"><span class="info-label">STOCK</span><div class="stock-line"><strong class="stock-value">${esc(state.num)}</strong><span class="ready-label">${state.label}</span></div></div></div>
    </article>`;
}

function pageHtml(products, context) {
    const { all, subtitle, lowStockThreshold, updatedAt, font, logo, layout } = context;
    const units = all.filter(x => Number(x.stock) > 0).reduce((sum, x) => sum + Number(x.stock), 0);
    const infinite = all.some(x => Number(x.stock) < 0);
    const categories = new Set(all.map(x => String(x.categoria || '').trim()).filter(Boolean)).size;
    const low = all.filter(x => Number(x.stock) >= 0 && Number(x.stock) <= lowStockThreshold).length;
    const updated = new Date(updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cards = products.map(x => productCard(x, lowStockThreshold, logo, layout)).join('');
    const height = pageHeight(products.length, layout);
    const compact = layout.compact;
    const brandWidth = compact ? 275 : 320;
    const statsMargin = compact ? '14px 0 16px' : '20px 0 22px';

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-display:block}` : ''}
:root{--green:#1ed760;--text:#f7faf8;--muted:#94a09a;--line:rgba(255,255,255,.072);--line-green:rgba(30,215,96,.16)}*{box-sizing:border-box}html,body{margin:0;width:${layout.width}px;height:${height}px;overflow:hidden;background:#030604}body{font-family:Market,Arial,sans-serif;color:var(--text)}
.board{width:100%;height:100%;position:relative;overflow:hidden;padding:${layout.paddingTop}px ${layout.paddingX}px 22px;background:radial-gradient(circle at 94% 0%,rgba(30,215,96,.15),transparent 21%),radial-gradient(circle at 0 100%,rgba(30,215,96,.06),transparent 24%),linear-gradient(145deg,#050906,#030604 48%,#050a07)}.content{position:relative;z-index:1}.header{display:grid;grid-template-columns:minmax(0,1fr) ${brandWidth}px;gap:${compact ? 18 : 24}px;align-items:start;min-height:${layout.headerHeight}px}
.eyebrow{display:inline-flex;align-items:center;gap:9px;width:max-content;padding:${compact ? '6px 10px' : '8px 13px'};border-radius:999px;border:1px solid rgba(30,215,96,.20);background:rgba(30,215,96,.075);color:#93f9b7;font-size:${compact ? 9 : 11}px;font-weight:850;letter-spacing:.17em}.eyebrow i,.avail i,.footer-dot{width:7px;height:7px;border-radius:50%;background:var(--green)}.hero{font-size:${layout.hero}px;line-height:.9;font-weight:950;letter-spacing:-.066em;margin:${compact ? '10px 0 6px' : '13px 0 8px'};white-space:nowrap}.hero span{color:var(--green)}.subtitle{font-size:${layout.subtitle}px;color:#9eaaa4}.hero-pills{display:flex;gap:8px;margin-top:${compact ? 10 : 13}px}.hero-pill{padding:${compact ? '5px 8px' : '7px 10px'};border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.022);font-size:${compact ? 8 : 10}px;color:#c7d1cb}
.brand{display:flex;align-items:center;gap:12px;padding:${compact ? '12px 14px' : '15px 17px'};border:1px solid var(--line-green);border-radius:${compact ? 19 : 22}px;background:linear-gradient(180deg,rgba(13,22,17,.94),rgba(7,11,9,.96));box-shadow:0 18px 42px rgba(0,0,0,.26)}.brand img,.brand .logo{width:${compact ? 52 : 62}px;height:${compact ? 52 : 62}px;border-radius:16px;object-fit:contain;background:#08110b;padding:5px}.brand small{display:block;color:#7e8b84;font-size:${compact ? 8 : 10}px;letter-spacing:.16em;font-weight:800;margin-bottom:4px}.brand b{display:block;font-size:${compact ? 20 : 24}px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${compact ? 11 : 16}px;margin:${statsMargin}}.stat{display:grid;grid-template-columns:${compact ? 40 : 50}px minmax(0,1fr);gap:${compact ? 10 : 13}px;align-items:center;min-height:${layout.statsHeight}px;padding:${compact ? '10px 12px' : '14px 17px'};border:1px solid var(--line);border-radius:${compact ? 17 : 20}px;background:linear-gradient(180deg,rgba(255,255,255,.033),rgba(255,255,255,.013))}.stat-icon{width:${compact ? 38 : 48}px;height:${compact ? 38 : 48}px;display:grid;place-items:center;border-radius:${compact ? 13 : 16}px;background:rgba(30,215,96,.075);border:1px solid rgba(30,215,96,.13)}.stat-icon svg{width:${compact ? 21 : 26}px;height:${compact ? 21 : 26}px;fill:none;stroke:#29e875;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.stat b{display:block;font-size:${layout.stat}px;line-height:.9;letter-spacing:-.055em;font-weight:950}.stat small{display:block;margin-top:6px;color:#839089;font-size:${compact ? 7 : 9}px;letter-spacing:.17em;font-weight:820}
.grid{display:grid;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));gap:${layout.gap}px}.card{position:relative;height:${layout.cardHeight}px;padding:${layout.cardPadding}px;border:1px solid rgba(255,255,255,.058);border-radius:${layout.radius}px;overflow:hidden;background:linear-gradient(180deg,rgba(10,15,12,.97),rgba(5,8,7,.99));display:flex;flex-direction:column;box-shadow:0 12px 26px rgba(0,0,0,.18)}.card-glow{position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(30,215,96,.065),transparent 37%)}.low .card-glow{background:radial-gradient(circle at 100% 0,rgba(255,191,109,.09),transparent 37%)}.accent{position:absolute;left:0;top:16px;bottom:16px;width:3px;background:linear-gradient(180deg,#2ff67c,rgba(30,215,96,.05))}.low .accent{background:linear-gradient(180deg,#ffc36e,rgba(255,195,110,.05))}
.topline{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:7px;margin-bottom:${compact ? 8 : 10}px}.cat{max-width:64%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:${compact ? '4px 6px' : '5px 8px'};border:1px solid rgba(255,255,255,.06);border-radius:999px;background:rgba(255,255,255,.038);color:#9aa69f;font-size:${compact ? 6 : 8}px;font-weight:820}.avail{display:inline-flex;align-items:center;gap:5px;color:#7ff2a6;font-size:${compact ? 6 : 8}px;font-weight:900;white-space:nowrap}.avail i{width:5px;height:5px}.low .avail{color:#ffc36e}.low .avail i{background:#ffc36e}
.product-row{position:relative;z-index:1;display:grid;grid-template-columns:${layout.thumb}px minmax(0,1fr);gap:${compact ? 9 : 12}px;align-items:center}.thumb{position:relative;width:${layout.thumb}px;height:${layout.thumb}px;border-radius:${Math.max(12, Math.round(layout.radius * .78))}px;overflow:hidden;background:var(--fallback);border:1px solid rgba(255,255,255,.10)}.fallback,.remote{position:absolute;inset:0;width:100%;height:100%}.fallback{display:grid;place-items:center}.fallback img{width:100%;height:100%;object-fit:contain;padding:${compact ? 6 : 9}px;background:#090d0a}.remote{object-fit:cover}.product-copy{min-width:0}.name{font-size:${layout.title}px;font-weight:900;line-height:1.08;letter-spacing:-.035em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.caption{margin-top:5px;color:#77837d;font-size:9px}
.info-panel{position:relative;z-index:1;margin-top:auto;display:grid;grid-template-columns:minmax(0,1fr) 1px minmax(0,1fr);min-height:${compact ? 46 : 60}px;border:1px solid rgba(30,215,96,.115);border-radius:${compact ? 11 : 14}px;background:linear-gradient(180deg,rgba(9,18,12,.72),rgba(5,11,8,.90));overflow:hidden}.info-cell{padding:${compact ? '7px 9px' : '9px 12px'};display:flex;flex-direction:column;justify-content:center;min-width:0}.info-divider{background:linear-gradient(180deg,transparent,rgba(30,215,96,.22),transparent)}.info-label{color:#839089;font-size:${compact ? 6 : 8}px;font-weight:820;letter-spacing:.14em;margin-bottom:${compact ? 3 : 5}px}.price-value{font-size:${layout.price}px;line-height:.92;letter-spacing:-.05em;font-weight:950;white-space:nowrap}.stock-line{display:flex;align-items:baseline;gap:${compact ? 4 : 7}px}.stock-value{font-size:${layout.stock}px;line-height:.92;letter-spacing:-.05em;font-weight:950;color:#8af6ae;white-space:nowrap}.low .stock-value{color:#ffc36e}.ready-label{font-size:${compact ? 5 : 7}px;color:#89958e;font-weight:820;white-space:nowrap}
.footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:${compact ? 13 : 16}px;padding-top:${compact ? 12 : 15}px;border-top:1px solid rgba(255,255,255,.052);font-size:${layout.footer}px;color:#89968f}.footer-left,.footer-right{display:flex;align-items:center;gap:8px}.footer strong{color:#f2f5f3}.footer-chip{padding:${compact ? '5px 8px' : '7px 10px'};border:1px solid rgba(255,255,255,.045);border-radius:999px;background:rgba(255,255,255,.025)}
</style></head><body><section class="board"><div class="content"><header class="header"><div><div class="eyebrow"><i></i>LIVE CATALOG</div><div class="hero"><span>LIVE</span> STOCK</div><div class="subtitle">${esc(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div><div class="hero-pills"><div class="hero-pill">Synced with <b>SellAuth</b></div><div class="hero-pill"><b>${all.length}</b> products on one board</div></div></div><aside class="brand">${logo ? `<img src="${logo}" alt="">` : '<div class="logo">SM</div>'}<div><small>SPOTIFY MARKET</small><b>Spotify Market</b></div></aside></header><section class="stats"><div class="stat"><div class="stat-icon">${statIcon('products')}</div><div><b>${all.length}</b><small>PRODUCTS LIVE</small></div></div><div class="stat"><div class="stat-icon">${statIcon('units')}</div><div><b>${infinite ? `${units}+` : units}</b><small>UNITS READY</small></div></div><div class="stat"><div class="stat-icon">${statIcon('categories')}</div><div><b>${categories}</b><small>CATEGORIES</small></div></div><div class="stat"><div class="stat-icon">${statIcon('low')}</div><div><b>${low}</b><small>LOW STOCK</small></div></div></section><main class="grid">${cards}</main><footer class="footer"><div class="footer-left"><i class="footer-dot"></i><span><strong>Spotify Market</strong> · Live digital inventory</span></div><div class="footer-right"><span class="footer-chip">All ${all.length} products</span><span>${esc(updated)}</span></div></footer></div></section></body></html>`;
}

function isExecutable(file) {
    try { if (!file) return false; fs.accessSync(file, fs.constants.X_OK); return true; }
    catch { return false; }
}

function resolveChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidates = [process.env.CHROMIUM_PATH?.trim(), process.env.CHROME_PATH?.trim(), '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].filter(Boolean);
    for (const file of candidates) if (isExecutable(file)) return chromiumCache = file;
    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
        try {
            const file = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (isExecutable(file)) return chromiumCache = file;
        } catch {}
    }
    return chromiumCache = '';
}

function tempBase() {
    for (const candidate of ['/dev/shm', os.tmpdir()]) {
        try { fs.accessSync(candidate, fs.constants.W_OK | fs.constants.X_OK); return candidate; }
        catch {}
    }
    return os.tmpdir();
}

function clean(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
function kill(child) { try { if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL'); } catch {} }
function friendly(error, where) {
    if (error?.code === 'EDQUOT' || Number(error?.errno) === -122) return new Error(`Cuota de escritura agotada (${where}). Temporal: ${tempBase()}.`);
    return error;
}

function render(html, width, height) {
    const chrome = resolveChromium();
    if (!chrome) return Promise.reject(new Error('No hay Chrome/Chromium disponible.'));
    let dir;
    try { dir = fs.mkdtempSync(path.join(tempBase(), 'spotify-stock-')); }
    catch (error) { return Promise.reject(friendly(error, 'crear temporal')); }
    const htmlPath = path.join(dir, 'board.html');
    const outputPath = path.join(dir, 'stock.png');
    const profilePath = path.join(dir, 'profile');
    try { fs.writeFileSync(htmlPath, html, 'utf8'); }
    catch (error) { clean(dir); return Promise.reject(friendly(error, 'guardar HTML')); }

    return new Promise((resolve, reject) => {
        const started = Date.now();
        let finished = false, stderr = '', timer;
        const finish = (error, buffer) => {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            clean(dir);
            error ? reject(friendly(error, 'captura')) : resolve(buffer);
        };
        const args = [
            '--headless=new','--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--hide-scrollbars',
            '--allow-file-access-from-files','--run-all-compositor-stages-before-draw','--virtual-time-budget=1200',
            '--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--mute-audio',
            '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost','--no-first-run',
            `--user-data-dir=${profilePath}`,`--window-size=${width},${height}`,'--force-device-scale-factor=1',
            `--screenshot=${outputPath}`, pathToFileURL(htmlPath).href
        ];
        const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: dir, TMPDIR: dir, XDG_CACHE_HOME: dir, XDG_CONFIG_HOME: dir } });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 8000) stderr = stderr.slice(-8000); });
        timer = setTimeout(() => { kill(child); finish(new Error(`Chrome agotó ${RENDER_TIMEOUT_MS / 1000}s generando el stock.`)); }, RENDER_TIMEOUT_MS);
        child.once('error', error => finish(new Error(`No se pudo iniciar Chrome: ${error.message}`)));
        child.once('close', code => {
            if (finished) return;
            try {
                if (code !== 0 || !fs.existsSync(outputPath)) return finish(new Error(`Chrome no generó la captura (${code ?? '?'}): ${stderr.trim().slice(-600) || 'sin detalle'}`));
                const buffer = fs.readFileSync(outputPath);
                if (buffer.length < 10000) return finish(new Error('La captura generada es demasiado pequeña.'));
                logger.detalle(`Stock Chromium terminó en ${Date.now() - started} ms`);
                finish(null, buffer);
            } catch (error) { finish(error); }
        });
    });
}

function nombreArchivoStock() { return 'spotify-market-live-stock.png'; }

async function generarPanelesStock(productos, opciones = {}) {
    const available = productos.filter(x => x?.visible && Number(x.stock) !== 0)
        .sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const updatedAt = Number(opciones.updatedAt) || Date.now();
    const lowStockThreshold = Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3;
    const layout = layoutFor(available.length);
    const prepared = await prepareImages(available);
    const font = fileUrl(FONT_PATH), logo = fileUrl(LOGO_PATH);
    const html = pageHtml(prepared, { all: available, subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.', lowStockThreshold, updatedAt, font, logo, layout });
    const height = pageHeight(available.length, layout);
    logger.detalle(`Stock fast-render: ${available.length} productos · ${layout.columns} columnas · ${layout.width}x${height} · html=${Math.round(Buffer.byteLength(html) / 1024)} KB`);
    const buffer = await render(html, layout.width, height);
    logger.detalle(`Stock fast-render completado: ${(buffer.length / 1024).toFixed(0)} KB`);
    return [{ pagina: 1, totalPaginas: 1, nombre: nombreArchivoStock(), buffer }];
}

async function cerrar() {}
function diagnostico() { const chromium = resolveChromium(); return { renderer: RENDERER_VERSION, chromiumPath: chromium || '', available: Boolean(chromium), tempBase: tempBase() }; }
module.exports = { ANCHO, PRODUCTOS_POR_PAGINA, RENDERER_VERSION, generarPanelesStock, nombreArchivoStock, diagnostico, cerrar };
