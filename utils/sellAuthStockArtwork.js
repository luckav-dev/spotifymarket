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
const RENDERER_VERSION = 'html-chromium-cdp-v9-single-board-premium';

let chromiumCache;
let browserPromise = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function esc(v) {
    return String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
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
    return `linear-gradient(135deg,hsl(${a} 60% 44%),hsl(${b} 70% 24%))`;
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
            mode: 'normal',
            width: 2048,
            columns: 4,
            gap: 22,
            cardHeight: 286,
            paddingX: 52,
            paddingTop: 42,
            paddingBottom: 28,
            thumb: 108,
            heroTitle: 94,
            subtitle: 21,
            title: 27,
            price: 41,
            stock: 34,
            radius: 28,
            cardPadding: 18,
            topReserve: 475,
            compact: false,
            statValue: 48,
            brandWidth: 360,
            headerGap: 28,
            footerSize: 14,
            captionSize: 12,
            categorySize: 10,
            smallLabelSize: 10,
            lineClamp: 2
        };
    }

    if (total <= 24) {
        return {
            mode: 'medium',
            width: 2200,
            columns: 5,
            gap: 18,
            cardHeight: 238,
            paddingX: 42,
            paddingTop: 34,
            paddingBottom: 26,
            thumb: 88,
            heroTitle: 82,
            subtitle: 18,
            title: 21,
            price: 33,
            stock: 27,
            radius: 24,
            cardPadding: 16,
            topReserve: 418,
            compact: false,
            statValue: 41,
            brandWidth: 340,
            headerGap: 24,
            footerSize: 13,
            captionSize: 11,
            categorySize: 10,
            smallLabelSize: 10,
            lineClamp: 2
        };
    }

    if (total <= 42) {
        return {
            mode: 'dense',
            width: 2400,
            columns: 6,
            gap: 16,
            cardHeight: 210,
            paddingX: 36,
            paddingTop: 30,
            paddingBottom: 24,
            thumb: 72,
            heroTitle: 70,
            subtitle: 17,
            title: 18,
            price: 28,
            stock: 23,
            radius: 22,
            cardPadding: 15,
            topReserve: 375,
            compact: true,
            statValue: 35,
            brandWidth: 320,
            headerGap: 22,
            footerSize: 13,
            captionSize: 11,
            categorySize: 10,
            smallLabelSize: 9,
            lineClamp: 2
        };
    }

    if (total <= 60) {
        return {
            mode: 'ultra',
            width: 2400,
            columns: 6,
            gap: 14,
            cardHeight: 188,
            paddingX: 32,
            paddingTop: 26,
            paddingBottom: 22,
            thumb: 62,
            heroTitle: 62,
            subtitle: 15,
            title: 16,
            price: 24,
            stock: 20,
            radius: 20,
            cardPadding: 13,
            topReserve: 348,
            compact: true,
            statValue: 30,
            brandWidth: 300,
            headerGap: 20,
            footerSize: 12,
            captionSize: 10,
            categorySize: 9,
            smallLabelSize: 8,
            lineClamp: 2
        };
    }

    return {
        mode: 'max',
        width: 2600,
        columns: 7,
        gap: 12,
        cardHeight: 176,
        paddingX: 28,
        paddingTop: 22,
        paddingBottom: 20,
        thumb: 56,
        heroTitle: 56,
        subtitle: 14,
        title: 15,
        price: 22,
        stock: 18,
        radius: 18,
        cardPadding: 12,
        topReserve: 332,
        compact: true,
        statValue: 28,
        brandWidth: 290,
        headerGap: 18,
        footerSize: 12,
        captionSize: 10,
        categorySize: 8,
        smallLabelSize: 8,
        lineClamp: 2
    };
}

function productCard(product, low, logo, layout) {
    const b = badge(product, low);
    const compact = layout.compact;

    return `<article class="product-card ${b.cls}">
      <div class="card-glow"></div>
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
        <div class="meta-left">
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
    const units = all.filter(x => Number(x.stock) > 0).reduce((a, x) => a + Number(x.stock), 0);
    const infinite = all.some(x => Number(x.stock) < 0);
    const categories = new Set(all.map(x => String(x.categoria || '').trim()).filter(Boolean)).size;
    const low = all.filter(x => Number(x.stock) >= 0 && Number(x.stock) <= lowStockThreshold).length;
    const updated = new Date(updatedAt).toLocaleString('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const cards = products.length
        ? products.map(x => productCard(x, lowStockThreshold, logo, layout)).join('')
        : `<div class="empty"><div class="empty-icon">↻</div><strong>Stock is being prepared</strong><span>New availability will appear here automatically.</span></div>`;
    const height = pageHeight(products.length, layout);
    const compactClass = layout.compact ? 'compact-mode' : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${layout.width},initial-scale=1">
<style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block}` : ''}
:root{
  --green:#1ed760;
  --green-soft:rgba(30,215,96,.14);
  --text:#f7faf8;
  --muted:#95a29b;
  --line:rgba(255,255,255,.075);
  --panel:rgba(10,14,12,.78);
  --panel-2:rgba(14,20,16,.88);
  --panel-3:rgba(255,255,255,.022);
  --shadow:0 26px 64px rgba(0,0,0,.32);
  --radius:${layout.radius}px;
  --card-padding:${layout.cardPadding}px;
  --card-height:${layout.cardHeight}px;
  --thumb:${layout.thumb}px;
  --columns:${layout.columns};
  --gap:${layout.gap}px;
  --title-size:${layout.title}px;
  --price-size:${layout.price}px;
  --stock-size:${layout.stock}px;
  --stat-size:${layout.statValue}px;
  --hero-title:${layout.heroTitle}px;
  --subtitle-size:${layout.subtitle}px;
  --footer-size:${layout.footerSize}px;
  --category-size:${layout.categorySize}px;
  --small-label:${layout.smallLabelSize}px;
  --caption-size:${layout.captionSize}px;
  --padding-x:${layout.paddingX}px;
  --padding-top:${layout.paddingTop}px;
  --padding-bottom:${layout.paddingBottom}px;
  --header-gap:${layout.headerGap}px;
  --brand-width:${layout.brandWidth}px;
}
*{box-sizing:border-box}
html,body{margin:0;width:${layout.width}px;height:${height}px;overflow:hidden;background:#040705}
body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text);letter-spacing:-.01em}
.board{position:relative;width:100%;height:100%;overflow:hidden;background:
  radial-gradient(circle at 95% 0%,rgba(30,215,96,.18),transparent 20%),
  radial-gradient(circle at 0% 100%,rgba(30,215,96,.085),transparent 22%),
  linear-gradient(145deg,#050906 0%,#040706 38%,#060a08 100%)}
.board:before{content:"";position:absolute;inset:0;pointer-events:none;background:
  linear-gradient(115deg,rgba(255,255,255,.014),transparent 26%,transparent 74%,rgba(30,215,96,.018)),
  repeating-linear-gradient(90deg,rgba(255,255,255,.006) 0,rgba(255,255,255,.006) 1px,transparent 1px,transparent 74px)}
.board:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.02),transparent 24%,transparent 80%,rgba(255,255,255,.012))}
.inner{position:relative;height:100%;padding:var(--padding-top) var(--padding-x) var(--padding-bottom);display:flex;flex-direction:column}
.top{display:grid;grid-template-columns:minmax(0,1fr) var(--brand-width);gap:var(--header-gap);align-items:stretch}
.hero{display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.eyebrow{display:inline-flex;align-items:center;gap:11px;width:max-content;padding:10px 16px;border-radius:999px;border:1px solid rgba(30,215,96,.18);background:rgba(30,215,96,.08);color:#91f8b6;font-size:15px;font-weight:820;letter-spacing:.16em;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)}
.eyebrow i{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 7px rgba(30,215,96,.08)}
.hero-copy{padding-top:18px}
.hero-title{font-size:var(--hero-title);line-height:.91;letter-spacing:-.065em;margin:0 0 14px;font-weight:950}
.hero-title .accent{color:var(--green)}
.hero-subtitle{max-width:1120px;font-size:var(--subtitle-size);line-height:1.42;color:#a2afa9}
.hero-meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
.hero-pill{display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:16px;border:1px solid var(--line);background:rgba(255,255,255,.026);color:#c9d2cd;font-size:12px;font-weight:720}
.hero-pill b{color:#fff;font-weight:900}
.hero-pill i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 6px rgba(30,215,96,.065)}
.brand-card{position:relative;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);border-radius:26px;padding:20px;background:linear-gradient(180deg,rgba(16,25,20,.82),rgba(8,12,10,.92));box-shadow:var(--shadow);overflow:hidden}
.brand-card:before{content:"";position:absolute;right:-40px;top:-50px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(30,215,96,.13),rgba(30,215,96,0) 70%)}
.brand-top{display:flex;align-items:flex-start;gap:16px;position:relative;z-index:1}
.brand-logo{width:70px;height:70px;border-radius:22px;object-fit:contain;background:rgba(30,215,96,.06);padding:8px;border:1px solid rgba(255,255,255,.04)}
.brand-fallback{width:70px;height:70px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-weight:950;font-size:34px}
.brand-copy small{display:block;color:#7b8881;font-size:12px;font-weight:780;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px}
.brand-copy strong{display:block;font-size:28px;line-height:1.05;letter-spacing:-.04em}
.brand-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px;margin-top:18px;border-top:1px solid var(--line);position:relative;z-index:1}
.brand-row span{font-size:13px;color:#90a098;font-weight:700}
.online{display:inline-flex;align-items:center;gap:9px;color:#92f7b5;font-weight:860;letter-spacing:.06em;text-transform:uppercase}
.online i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 6px rgba(30,215,96,.065)}
.brand-chip-list{display:flex;flex-direction:column;gap:10px;margin-top:16px;position:relative;z-index:1}
.brand-chip{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.04)}
.brand-chip span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7e8a84;font-weight:800}
.brand-chip b{font-size:12px;color:#eef3f0;font-weight:820}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:24px 0 22px}
.stat{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:22px;padding:18px 20px;min-height:96px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.014));box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
.stat:before{content:"";position:absolute;right:-34px;top:-52px;width:112px;height:112px;border-radius:50%;background:radial-gradient(circle,rgba(30,215,96,.10),rgba(30,215,96,0) 72%)}
.stat-value{position:relative;font-size:var(--stat-size);font-weight:950;line-height:.94;letter-spacing:-.06em;margin-bottom:8px}
.stat-label{position:relative;font-size:11px;color:#7f8c85;letter-spacing:.18em;text-transform:uppercase;font-weight:820}
.products{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:var(--gap);align-content:start;flex:1}
.product-card{position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:var(--card-height);padding:var(--card-padding);border-radius:var(--radius);border:1px solid rgba(255,255,255,.055);background:linear-gradient(180deg,rgba(10,15,12,.96),rgba(5,8,7,.98));box-shadow:0 16px 36px rgba(0,0,0,.23)}
.product-card:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
.card-glow{position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(30,215,96,.08),transparent 35%);pointer-events:none}
.product-card.low .card-glow{background:radial-gradient(circle at 100% 0,rgba(255,188,92,.11),transparent 35%)}
.card-accent{position:absolute;left:0;top:22px;bottom:22px;width:3px;border-radius:0 8px 8px 0;background:linear-gradient(180deg,var(--green),rgba(30,215,96,.06))}
.product-card.low .card-accent{background:linear-gradient(180deg,#ffbf6d,rgba(255,191,109,.06))}
.card-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.category-pill{max-width:66%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#94a29c;font-size:var(--category-size);font-weight:820;letter-spacing:.16em;text-transform:uppercase}
.availability{display:inline-flex;align-items:center;gap:7px;color:#84f5ac;font-size:var(--small-label);font-weight:900;letter-spacing:.12em;white-space:nowrap;text-transform:uppercase}
.product-card.low .availability{color:#ffc36e}
.availability i{width:7px;height:7px;border-radius:50%;background:currentColor}
.product-head{position:relative;z-index:1;display:grid;grid-template-columns:var(--thumb) minmax(0,1fr);gap:14px;align-items:center}
.thumb{position:relative;width:var(--thumb);height:var(--thumb);border-radius:${Math.max(14, Math.round(layout.radius * 0.82))}px;overflow:hidden;background:var(--fallback);border:1px solid rgba(255,255,255,.10);box-shadow:0 14px 28px rgba(0,0,0,.22)}
.thumb-fallback,.remote-image{position:absolute;inset:0;width:100%;height:100%}
.thumb-fallback{display:grid;place-items:center;font-size:28px;font-weight:900}
.thumb-fallback img{width:100%;height:100%;object-fit:contain;padding:12px;background:#090d0a}
.remote-image{object-fit:cover}
.product-copy{min-width:0}
.product-name{font-size:var(--title-size);line-height:1.08;letter-spacing:-.035em;font-weight:900;display:-webkit-box;-webkit-line-clamp:${layout.lineClamp};-webkit-box-orient:vertical;overflow:hidden;text-wrap:balance}
.product-caption{margin-top:7px;color:#74807a;font-size:var(--caption-size);font-weight:650;line-height:1.3}
.divider{position:relative;z-index:1;height:1px;margin:16px 0 14px;background:linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.02))}
.product-meta{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-top:auto}
.meta-left{min-width:0}
.meta-label{color:#7b8881;font-size:var(--small-label);font-weight:820;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px}
.price{font-size:var(--price-size);font-weight:950;letter-spacing:-.055em;line-height:.92;white-space:nowrap}
.stock-block{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;text-align:right;min-width:74px}
.stock-number{font-size:var(--stock-size);line-height:.88;font-weight:950;letter-spacing:-.05em;color:#86f8af}
.low .stock-number{color:#ffc36e}
.unlimited .stock-number{color:#eef3f0}
.stock-label{margin-top:6px;color:#76827d;font-size:var(--small-label);font-weight:840;letter-spacing:.12em;text-transform:uppercase}
.empty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:var(--card-height);gap:10px;border:1px solid var(--line);border-radius:var(--radius);background:rgba(255,255,255,.025)}
.empty-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:18px;background:rgba(30,215,96,.09);color:#7cf2a5;font-size:28px}
.empty strong{font-size:30px;letter-spacing:-.04em}
.empty span{font-size:16px;color:var(--muted)}
.footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:18px;margin-top:18px;border-top:1px solid rgba(255,255,255,.055);font-size:var(--footer-size);color:#88968f}
.footer strong{color:#eef3f0}
.footer-left{display:flex;align-items:center;gap:12px}
.footer-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 6px rgba(30,215,96,.06)}
.footer-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
.footer-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.045);color:#d7dfda;font-weight:780}
.footer-chip i{width:7px;height:7px;border-radius:50%;background:var(--green)}
.compact-mode .hero-pill{padding:8px 12px;font-size:11px}
.compact-mode .brand-chip{padding:9px 11px}
.compact-mode .brand-copy strong{font-size:24px}
.compact-mode .card-top{margin-bottom:12px}
.compact-mode .divider{margin:14px 0 12px}
.compact-mode .stock-label{margin-top:4px}
</style>
</head>
<body>
<section class="board ${compactClass}">
  <div class="inner">
    <section class="top">
      <div class="hero">
        <div>
          <div class="eyebrow"><i></i>Live catalog</div>
          <div class="hero-copy">
            <h1 class="hero-title"><span class="accent">LIVE</span> STOCK</h1>
            <div class="hero-subtitle">${esc(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div>
            <div class="hero-meta">
              <div class="hero-pill"><i></i><span>Synced with <b>SellAuth</b></span></div>
              <div class="hero-pill"><span><b>${all.length}</b> products on one live board</span></div>
            </div>
          </div>
        </div>
      </div>

      <aside class="brand-card">
        <div>
          <div class="brand-top">
            ${logo ? `<img class="brand-logo" src="${logo}" alt="">` : `<div class="brand-fallback">SM</div>`}
            <div class="brand-copy">
              <small>Spotify Market</small>
              <strong>${esc(title || 'Stock board')}</strong>
            </div>
          </div>

          <div class="brand-chip-list">
            <div class="brand-chip"><span>Board mode</span><b>Single live image</b></div>
            <div class="brand-chip"><span>Last update</span><b>${esc(updated)}</b></div>
          </div>
        </div>

        <div class="brand-row">
          <span>Real-time availability</span>
          <span class="online"><i></i>Online</span>
        </div>
      </aside>
    </section>

    <section class="stats">
      <div class="stat"><div class="stat-value">${all.length}</div><div class="stat-label">Products live</div></div>
      <div class="stat"><div class="stat-value">${infinite ? `${units}+` : units}</div><div class="stat-label">Units ready</div></div>
      <div class="stat"><div class="stat-value">${categories}</div><div class="stat-label">Categories</div></div>
      <div class="stat"><div class="stat-value">${low}</div><div class="stat-label">Low stock</div></div>
    </section>

    <main class="products">${cards}</main>

    <footer class="footer">
      <div class="footer-left">
        <span class="footer-dot"></span>
        <span><strong>Spotify Market</strong> · Premium live inventory board</span>
      </div>
      <div class="footer-right">
        <span class="footer-chip"><i></i>All ${all.length} products</span>
        <span>${esc(updated)}</span>
      </div>
    </footer>
  </div>
</section>
</body>
</html>`;
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
            for (const p of this.pending.values()) p.reject(new Error('Chromium cerro la conexion CDP.'));
            this.pending.clear();
        };
    }

    async send(method, params = {}, sessionId = '') {
        await this.ready;
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
            quality: 92,
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
        `Stock single-board premium: ${available.length} productos · ${layout.columns} columnas · ${layout.width}x${height}`
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
