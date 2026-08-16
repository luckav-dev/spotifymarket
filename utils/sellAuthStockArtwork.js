'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const logger = require('./logger');

const ROOT = path.resolve(__dirname, '..');
const FONT_PATH = path.join(ROOT, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const LOGO_PATH = path.join(ROOT, 'assets', 'brand', 'SpotifyMarket.png');
const ANCHO = 2400;
const PRODUCTOS_POR_PAGINA = 60;
const RENDERER_VERSION = 'html-chromium-cdp-v8-single-board';

let chromiumCache;
let browserPromise = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function esc(v) {
    return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function money(value, currency = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: String(currency || 'EUR').toUpperCase(),
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    } catch {
        return `${Number(value || 0).toFixed(2)} ${String(currency || 'EUR').toUpperCase()}`;
    }
}

function dataFile(file, mime) {
    try {
        return fs.existsSync(file)
            ? `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
            : '';
    } catch {
        return '';
    }
}

function initials(name) {
    return String(name || 'SM')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(x => x[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'SM';
}

function gradient(product) {
    const h = crypto.createHash('sha1').update(String(product.id || product.nombre || '')).digest();
    const a = Math.round(h[0] * 360 / 255);
    const b = (a + 42 + h[1] % 64) % 360;
    return `linear-gradient(135deg,hsl(${a} 58% 42%),hsl(${b} 68% 23%))`;
}

function badge(product, low) {
    const stock = Number(product.stock);
    if (stock < 0) return { cls: 'unlimited', top: 'AVAILABLE', num: '∞', label: 'Unlimited' };
    if (stock <= low) return { cls: 'low', top: 'LOW STOCK', num: String(stock), label: 'Ready now' };
    return { cls: 'normal', top: 'AVAILABLE', num: String(stock), label: 'Ready now' };
}

function imageMarkup(product, logo) {
    const url = /^https:\/\//i.test(String(product.imagen || '')) ? esc(product.imagen) : '';
    const fallback = logo
        ? `<img class="fallback-logo" src="${logo}" alt="">`
        : `<span>${esc(initials(product.nombre))}</span>`;
    return `<div class="thumb-fallback">${fallback}</div>${url ? `<img class="remote-image" src="${url}" alt="" onerror="this.remove()">` : ''}`;
}

function layoutFor(count) {
    const total = Math.max(1, Number(count) || 1);

    if (total <= 12) {
        return {
            mode: 'normal', width: 2048, columns: 4, gap: 22, cardHeight: 286,
            paddingX: 52, paddingTop: 44, paddingBottom: 30, thumb: 104,
            heroTitle: 94, subtitle: 21, title: 26, price: 41, stock: 33,
            radius: 28, cardPadding: 18, topReserve: 498, compact: false
        };
    }

    if (total <= 24) {
        return {
            mode: 'medium', width: 2200, columns: 5, gap: 18, cardHeight: 238,
            paddingX: 42, paddingTop: 36, paddingBottom: 28, thumb: 86,
            heroTitle: 80, subtitle: 18, title: 21, price: 33, stock: 27,
            radius: 24, cardPadding: 16, topReserve: 430, compact: false
        };
    }

    if (total <= 42) {
        return {
            mode: 'dense', width: 2400, columns: 6, gap: 16, cardHeight: 208,
            paddingX: 36, paddingTop: 32, paddingBottom: 26, thumb: 72,
            heroTitle: 70, subtitle: 17, title: 18, price: 28, stock: 23,
            radius: 22, cardPadding: 15, topReserve: 390, compact: true
        };
    }

    if (total <= 60) {
        return {
            mode: 'ultra', width: 2400, columns: 6, gap: 14, cardHeight: 188,
            paddingX: 32, paddingTop: 28, paddingBottom: 24, thumb: 62,
            heroTitle: 62, subtitle: 16, title: 16, price: 24, stock: 20,
            radius: 20, cardPadding: 13, topReserve: 360, compact: true
        };
    }

    return {
        mode: 'max', width: 2600, columns: 7, gap: 12, cardHeight: 176,
        paddingX: 28, paddingTop: 24, paddingBottom: 22, thumb: 56,
        heroTitle: 56, subtitle: 15, title: 15, price: 22, stock: 18,
        radius: 18, cardPadding: 12, topReserve: 340, compact: true
    };
}

function productCard(product, low, logo, layout) {
    const b = badge(product, low);
    const compact = layout.compact;

    return `<article class="product-card ${b.cls}">
      <div class="card-accent"></div>
      <div class="card-top">
        <span class="category-pill">${esc(product.categoria || 'Catalog')}</span>
        <span class="availability"><i></i>${b.top}</span>
      </div>
      <div class="product-head">
        <div class="thumb" style="--fallback:${gradient(product)}">${imageMarkup(product, logo)}</div>
        <div class="product-copy">
          <div class="product-name">${esc(product.nombre)}</div>
          ${compact ? '' : '<div class="product-caption">Instant digital delivery</div>'}
        </div>
      </div>
      <div class="divider"></div>
      <div class="product-meta">
        <div>
          ${compact ? '' : '<div class="meta-label">Price</div>'}
          <div class="price">${esc(money(product.precio, product.moneda))}</div>
        </div>
        <div class="stock-block">
          <div class="stock-number">${esc(b.num)}</div>
          <div class="stock-label">${b.label}</div>
        </div>
      </div>
    </article>`;
}

function pageHeight(count, layout) {
    const rows = Math.max(1, Math.ceil(Math.max(1, count) / layout.columns));
    return layout.topReserve + rows * layout.cardHeight + Math.max(0, rows - 1) * layout.gap;
}

function pageHtml(products, ctx) {
    const { all, title, subtitle, lowStockThreshold, updatedAt, font, logo, layout } = ctx;
    const units = all
        .filter(x => Number(x.stock) > 0)
        .reduce((a, x) => a + Number(x.stock), 0);
    const infinite = all.some(x => Number(x.stock) < 0);
    const categories = new Set(
        all.map(x => String(x.categoria || '').trim()).filter(Boolean)
    ).size;
    const low = all.filter(
        x => Number(x.stock) >= 0 && Number(x.stock) <= lowStockThreshold
    ).length;
    const cards = products.length
        ? products.map(x => productCard(x, lowStockThreshold, logo, layout)).join('')
        : '<div class="empty"><div class="empty-icon">↻</div><strong>Stock is being prepared</strong><span>New availability will appear here automatically.</span></div>';
    const updated = new Date(updatedAt).toLocaleString('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const height = pageHeight(products.length, layout);
    const compact = layout.compact;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${layout.width},initial-scale=1"><style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block}` : ''}
:root{--green:#1ed760;--text:#f7faf8;--muted:#98a59e;--line:rgba(255,255,255,.085);--shadow:0 20px 48px rgba(0,0,0,.25)}
*{box-sizing:border-box}
html,body{margin:0;width:${layout.width}px;height:${height}px;overflow:hidden;background:#040705}
body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text)}
.board{width:100%;height:100%;position:relative;overflow:hidden;background:radial-gradient(circle at 92% -8%,rgba(30,215,96,.19),transparent 27%),radial-gradient(circle at -4% 104%,rgba(30,215,96,.075),transparent 26%),linear-gradient(145deg,#07100b 0%,#050806 46%,#080b09 100%)}
.board:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.018),transparent 26%,transparent 74%,rgba(30,215,96,.02)),repeating-linear-gradient(90deg,rgba(255,255,255,.007) 0,rgba(255,255,255,.007) 1px,transparent 1px,transparent 64px)}
.inner{position:relative;height:100%;padding:${layout.paddingTop}px ${layout.paddingX}px ${layout.paddingBottom}px;display:flex;flex-direction:column}
.header{display:grid;grid-template-columns:minmax(0,1fr) ${compact ? 330 : 390}px;gap:${compact ? 20 : 28}px}
.hero{padding-top:2px}
.eyebrow{display:inline-flex;align-items:center;gap:${compact ? 8 : 11}px;padding:${compact ? '7px 11px' : '10px 16px'};border-radius:999px;border:1px solid rgba(30,215,96,.22);background:rgba(30,215,96,.09);color:#8bf7b0;font-size:${compact ? 11 : 15}px;font-weight:820;letter-spacing:.14em;text-transform:uppercase}
.eyebrow i{width:${compact ? 7 : 9}px;height:${compact ? 7 : 9}px;border-radius:50%;background:var(--green);box-shadow:0 0 0 ${compact ? 5 : 7}px rgba(30,215,96,.08)}
.hero-title{font-size:${layout.heroTitle}px;line-height:.93;letter-spacing:-.062em;margin:${compact ? '10px 0 7px' : '17px 0 12px'};font-weight:900}
.hero-title span{color:var(--green)}
.subtitle{font-size:${layout.subtitle}px;line-height:1.4;color:#a5b0aa;max-width:1300px}
.brand{display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);border-radius:${compact ? 22 : 28}px;padding:${compact ? 15 : 20}px;background:linear-gradient(180deg,rgba(255,255,255,.042),rgba(255,255,255,.018));box-shadow:var(--shadow)}
.brand-top{display:flex;align-items:center;gap:${compact ? 13 : 17}px}
.brand-logo,.brand-fallback{width:${compact ? 58 : 72}px;height:${compact ? 58 : 72}px;border-radius:${compact ? 17 : 22}px}
.brand-logo{object-fit:contain;background:rgba(30,215,96,.08);padding:${compact ? 6 : 7}px}
.brand-fallback{display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-weight:950;font-size:${compact ? 28 : 36}px}
.brand small{display:block;color:#76847c;font-size:${compact ? 10 : 12}px;font-weight:780;letter-spacing:.18em;text-transform:uppercase;margin-bottom:${compact ? 4 : 6}px}
.brand strong{font-size:${compact ? 23 : 29}px;letter-spacing:-.035em}
.brand-status{display:flex;justify-content:space-between;align-items:center;margin-top:${compact ? 12 : 18}px;padding-top:${compact ? 10 : 16}px;border-top:1px solid var(--line);color:#87948d;font-size:${compact ? 10 : 13}px;font-weight:720}
.online{display:flex;align-items:center;gap:7px;color:#90f7b4}
.online i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(30,215,96,.09)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${compact ? 12 : 16}px;margin:${compact ? '18px 0' : '26px 0'}}
.stat{position:relative;overflow:hidden;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.018));border-radius:${compact ? 17 : 22}px;padding:${compact ? '12px 15px' : '18px 20px'};min-height:${compact ? 72 : 96}px}
.stat:after{content:"";position:absolute;width:120px;height:120px;border-radius:50%;right:-52px;top:-64px;background:rgba(30,215,96,.055)}
.stat-value{font-size:${compact ? Math.max(27, layout.price + 5) : 46}px;font-weight:900;letter-spacing:-.055em;line-height:.95;margin-bottom:${compact ? 6 : 9}px}
.stat-label{font-size:${compact ? 9 : 11}px;color:#7d8a83;letter-spacing:.16em;text-transform:uppercase;font-weight:800}
.products{display:grid;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));gap:${layout.gap}px}
.product-card{position:relative;overflow:hidden;height:${layout.cardHeight}px;border-radius:${layout.radius}px;padding:${layout.cardPadding}px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(14,19,16,.98),rgba(8,11,9,.99));box-shadow:var(--shadow);display:flex;flex-direction:column}
.product-card:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(30,215,96,.075),transparent 35%);pointer-events:none}
.product-card.low:before{background:radial-gradient(circle at 100% 0,rgba(255,175,77,.09),transparent 35%)}
.card-accent{position:absolute;left:0;top:${compact ? 18 : 28}px;bottom:${compact ? 18 : 28}px;width:3px;border-radius:0 6px 6px 0;background:linear-gradient(180deg,var(--green),rgba(30,215,96,.06))}
.product-card.low .card-accent{background:linear-gradient(180deg,#ffb454,rgba(255,180,84,.06))}
.card-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:${compact ? 9 : 16}px}
.category-pill{max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:${compact ? '5px 7px' : '7px 10px'};border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);color:#9aa69f;font-size:${compact ? 8 : 10}px;font-weight:820;letter-spacing:.1em;text-transform:uppercase}
.availability{display:flex;align-items:center;gap:${compact ? 5 : 7}px;color:#75ee9e;font-size:${compact ? 8 : 10}px;font-weight:850;letter-spacing:.08em;white-space:nowrap}
.product-card.low .availability{color:#ffc06b}
.availability i{width:${compact ? 6 : 7}px;height:${compact ? 6 : 7}px;border-radius:50%;background:currentColor}
.product-head{position:relative;z-index:1;display:grid;grid-template-columns:${layout.thumb}px minmax(0,1fr);gap:${compact ? 11 : 18}px;align-items:center;min-width:0}
.thumb{position:relative;width:${layout.thumb}px;height:${layout.thumb}px;border-radius:${Math.max(14, Math.round(layout.radius * .88))}px;overflow:hidden;background:var(--fallback);border:1px solid rgba(255,255,255,.11);box-shadow:0 12px 24px rgba(0,0,0,.22)}
.thumb-fallback,.remote-image{position:absolute;inset:0;width:100%;height:100%}
.thumb-fallback{display:grid;place-items:center;font-size:${compact ? 20 : 28}px;font-weight:900}
.thumb-fallback img{width:100%;height:100%;object-fit:contain;padding:${compact ? 8 : 13}px;background:#090d0a}
.remote-image{object-fit:cover}
.product-copy{min-width:0}
.product-name{font-size:${layout.title}px;line-height:1.08;letter-spacing:-.035em;font-weight:880;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.product-caption{margin-top:8px;color:#75827b;font-size:12px;font-weight:650}
.divider{position:relative;z-index:1;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.035));margin:${compact ? '10px 0 9px' : '20px 0 17px'}}
.product-meta{position:relative;z-index:1;margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;min-width:0}
.meta-label{color:#7f8c85;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px}
.price{font-size:${layout.price}px;font-weight:900;letter-spacing:-.055em;line-height:.93;white-space:nowrap}
.stock-block{text-align:right;min-width:${compact ? 60 : 88}px}
.stock-number{font-size:${layout.stock}px;line-height:.9;font-weight:900;letter-spacing:-.05em;color:#80f4a7}
.low .stock-number{color:#ffc06b}
.unlimited .stock-number{color:#d9e0dc}
.stock-label{margin-top:${compact ? 5 : 8}px;color:#77847d;font-size:${compact ? 8 : 10}px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.empty{grid-column:1/-1;min-height:286px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.024);gap:10px}
.empty-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:18px;background:rgba(30,215,96,.09);color:#7cf2a5;font-size:28px}
.empty strong{font-size:32px}
.empty span{font-size:17px;color:var(--muted)}
.footer{margin-top:auto;display:flex;justify-content:space-between;align-items:center;padding-top:${compact ? 16 : 24}px;border-top:1px solid var(--line);color:#87948d;font-size:${compact ? 11 : 14}px}
.footer strong{color:#edf3ef}
.live{display:flex;align-items:center;gap:${compact ? 8 : 11}px}
.live i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(30,215,96,.09)}
.page{color:#82f4a8;font-weight:800}
</style></head><body><section class="board"><div class="inner"><header class="header"><div class="hero"><div class="eyebrow"><i></i>Live catalog</div><div class="hero-title"><span>LIVE</span> STOCK</div><div class="subtitle">${esc(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div></div><div class="brand"><div class="brand-top">${logo ? `<img class="brand-logo" src="${logo}" alt="">` : '<div class="brand-fallback">SM</div>'}<div><small>Spotify Market</small><strong>${esc(title || 'Stock board')}</strong></div></div><div class="brand-status"><span>Real-time availability</span><span class="online"><i></i>ONLINE</span></div></div></header><section class="stats"><div class="stat"><div class="stat-value">${all.length}</div><div class="stat-label">Products live</div></div><div class="stat"><div class="stat-value">${infinite ? `${units}+` : units}</div><div class="stat-label">Units ready</div></div><div class="stat"><div class="stat-value">${categories}</div><div class="stat-label">Categories</div></div><div class="stat"><div class="stat-value">${low}</div><div class="stat-label">Low stock</div></div></section><main class="products">${cards}</main><footer class="footer"><div><strong>Spotify Market</strong> · Live digital inventory</div><div class="live"><i></i><span class="page">All ${all.length} products · One live board</span><span>·</span><span>${esc(updated)}</span></div></footer></div></section></body></html>`;
}

function isExecutable(file) {
    try {
        if (!file) return false;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function puppeteerCandidates() {
    const home = process.env.HOME || os.homedir();
    const out = [];
    for (const base of [
        path.join(home, '.cache', 'puppeteer', 'chrome'),
        path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell')
    ]) {
        try {
            for (const version of fs.readdirSync(base)) {
                out.push(path.join(base, version, 'chrome-linux64', 'chrome'));
                out.push(path.join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
            }
        } catch {}
    }
    return out;
}

function resolveChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidates = [
        process.env.CHROMIUM_PATH?.trim(),
        process.env.PUPPETEER_EXECUTABLE_PATH?.trim(),
        process.env.CHROME_PATH?.trim(),
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        ...puppeteerCandidates()
    ].filter(Boolean);

    for (const file of candidates) {
        if (isExecutable(file)) return chromiumCache = file;
    }

    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
        try {
            const file = execFileSync('which', [name], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            if (isExecutable(file)) return chromiumCache = file;
        } catch {}
    }

    return chromiumCache = '';
}

class CdpClient {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.id = 0;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = () => reject(new Error('No se pudo abrir WebSocket con Chromium.'));
        });
        this.ws.onmessage = event => {
            const msg = JSON.parse(event.data);
            if (!msg.id || !this.pending.has(msg.id)) return;
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            msg.error
                ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
                : p.resolve(msg.result);
        };
        this.ws.onclose = () => {
            for (const p of this.pending.values()) {
                p.reject(new Error('Chromium cerro la conexion CDP.'));
            }
            this.pending.clear();
        };
    }

    async send(method, params = {}, sessionId = '') {
        await this.ready;
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({
                id,
                method,
                params,
                ...(sessionId ? { sessionId } : {})
            }));
        });
    }

    close() {
        try {
            this.ws.close();
        } catch {}
    }
}

async function startBrowser() {
    const chromium = resolveChromium();
    if (!chromium) {
        throw new Error('No hay Chromium disponible. Instala Chrome/Chromium en la VPS o define CHROMIUM_PATH.');
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-stock-browser-'));
    const process = spawn(chromium, [
        '--headless',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--hide-scrollbars',
        '--remote-debugging-port=0',
        `--user-data-dir=${dir}`,
        'about:blank'
    ], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
            ...global.process.env,
            HOME: global.process.env.HOME || os.tmpdir()
        }
    });

    let stderr = '';
    let wsUrl = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', chunk => {
        stderr += chunk;
        if (stderr.length > 12000) stderr = stderr.slice(-12000);
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) wsUrl = m[1];
    });

    for (let i = 0; i < 120 && !wsUrl; i++) {
        if (process.exitCode !== null) break;
        await sleep(50);
    }

    if (!wsUrl) {
        process.kill('SIGTERM');
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`Chromium no expuso DevTools: ${stderr.trim().slice(-700) || 'sin detalle'}`);
    }

    const cdp = new CdpClient(wsUrl);
    await cdp.ready;
    const browser = { process, dir, cdp, chromium };
    process.once('exit', () => {
        browserPromise = null;
    });
    logger.detalle(`Stock HTML renderer ${RENDERER_VERSION} · Chromium ${chromium}`);
    return browser;
}

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = startBrowser().catch(error => {
            browserPromise = null;
            throw error;
        });
    }
    return browserPromise;
}

async function render(html, width, height) {
    const browser = await getBrowser();
    const { cdp } = browser;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });

    try {
        const { sessionId } = await cdp.send('Target.attachToTarget', {
            targetId,
            flatten: true
        });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false
        }, sessionId);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
        await cdp.send('Page.setDocumentContent', {
            frameId: frameTree.frame.id,
            html
        }, sessionId);
        await cdp.send('Runtime.evaluate', {
            expression: `Promise.all([document.fonts?.ready,Promise.race([Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,4500))])]).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`,
            awaitPromise: true,
            returnByValue: true
        }, sessionId);

        const shot = await cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 91,
            fromSurface: true,
            captureBeyondViewport: false
        }, sessionId);
        const buffer = Buffer.from(shot.data, 'base64');
        if (buffer.length < 10000) {
            throw new Error('Chromium genero una captura demasiado pequena.');
        }
        return buffer;
    } finally {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => null);
    }
}

function nombreArchivoStock() {
    return 'spotify-market-live-stock.jpg';
}

async function generarPanelesStock(productos, opciones = {}) {
    const available = productos
        .filter(x => x?.visible && Number(x.stock) !== 0)
        .sort((a, b) =>
            String(a.categoria || '').localeCompare(String(b.categoria || ''))
            || String(a.nombre || '').localeCompare(String(b.nombre || ''))
        );

    const updatedAt = Number(opciones.updatedAt) || Date.now();
    const lowStockThreshold = Number.isFinite(Number(opciones.lowStockThreshold))
        ? Number(opciones.lowStockThreshold)
        : 3;
    const layout = layoutFor(available.length);
    const font = dataFile(FONT_PATH, 'font/ttf');
    const logo = dataFile(LOGO_PATH, 'image/png');
    const html = pageHtml(available, {
        all: available,
        title: opciones.title || 'Stock board',
        subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.',
        lowStockThreshold,
        updatedAt,
        font,
        logo,
        layout
    });
    const height = pageHeight(available.length, layout);
    const nombre = nombreArchivoStock();

    logger.detalle(
        `Stock single-board: ${available.length} productos · ${layout.columns} columnas · ${layout.width}x${height}`
    );

    return [{
        pagina: 1,
        totalPaginas: 1,
        nombre,
        buffer: await render(html, layout.width, height)
    }];
}

async function cerrar() {
    if (!browserPromise) return;
    try {
        const b = await browserPromise;
        b.cdp.close();
        b.process.kill('SIGTERM');
        await sleep(100);
        fs.rmSync(b.dir, { recursive: true, force: true });
    } catch {
    } finally {
        browserPromise = null;
    }
}

function diagnostico() {
    const chromium = resolveChromium();
    return {
        renderer: RENDERER_VERSION,
        chromiumPath: chromium || '',
        available: Boolean(chromium)
    };
}

module.exports = {
    ANCHO,
    PRODUCTOS_POR_PAGINA,
    RENDERER_VERSION,
    generarPanelesStock,
    nombreArchivoStock,
    diagnostico,
    cerrar
};