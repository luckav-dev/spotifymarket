'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const config = require('../utils/config');
const Database = require('../utils/jsonDatabase');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const { SellAuthClient } = require('../utils/sellAuthClient');

const DB_SCHEMA = {
    initialized: false,
    announced: {},
    lastScanAt: 0,
    lastAnnouncedAt: 0,
    lastError: ''
};

const MAX_ANNOUNCED = 1500;
const DEFAULT_POLL_MS = 20000;
const DEFAULT_LOOKBACK_MIN = 30;

function clean(value, fallback = '—') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function safe(value, fallback = '—') {
    return clean(value, fallback).replace(/([\\`*_~|>])/g, '\\$1');
}

function money(value, currency = 'EUR') {
    const number = Number(value);
    const code = clean(currency, 'EUR').toUpperCase();
    return Number.isFinite(number)
        ? `${number.toFixed(2)} ${code}`
        : `${clean(value, '0')} ${code}`;
}

function invoiceKey(invoice) {
    return String(invoice?.id ?? invoice?.unique_id ?? '').trim();
}

function completedAtMs(invoice) {
    const ms = Date.parse(invoice?.completed_at || invoice?.updated_at || invoice?.created_at || '');
    return Number.isFinite(ms) ? ms : 0;
}

function discordId(invoice) {
    const candidates = [
        invoice?.discord_id,
        invoice?.discord_user_id,
        invoice?.discord?.id,
        invoice?.customer?.discord_id,
        invoice?.customer?.discord_user_id,
        invoice?.shop_customer?.discord_id,
        invoice?.shop_customer?.discord_user_id
    ];
    return candidates
        .map(value => String(value ?? '').trim())
        .find(value => /^\d{17,20}$/.test(value)) || '';
}

function discordName(invoice) {
    return clean(
        invoice?.discord_user_username
        || invoice?.discord_username
        || invoice?.discord?.username
        || invoice?.customer?.discord_username
        || invoice?.shop_customer?.discord_username,
        ''
    );
}

function email(invoice) {
    return clean(
        invoice?.email
        || invoice?.customer?.email
        || invoice?.shop_customer?.email,
        ''
    );
}

function productRows(invoice) {
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    if (!items.length) return [{ quantity: 1, name: 'Purchase details unavailable' }];

    const rows = items.slice(0, 8).map(item => {
        const quantity = Math.max(1, Math.trunc(Number(item?.quantity) || 1));
        const product = clean(item?.product?.name || item?.product_name, 'Product');
        const variant = clean(item?.variant?.name || item?.variant_name, '');
        return {
            quantity,
            name: variant && variant !== product ? `${product} — ${variant}` : product
        };
    });

    if (items.length > 8) rows.push({ quantity: 0, name: `+${items.length - 8} more item(s)` });
    return rows;
}

function httpsUrl(value) {
    const text = String(value ?? '').trim();
    if (!/^https:\/\//i.test(text)) return '';
    try {
        return new URL(text).toString();
    } catch {
        return '';
    }
}

function gatewayCode(invoice) {
    return clean(invoice?.gateway, '').toUpperCase();
}

class SellAuthPaymentWatcher {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('sellauth-payment-events', DB_SCHEMA);
        this.timer = null;
        this.running = null;
        this.warnedNoChannel = false;
        this.shopBasePromise = null;
    }

    get settings() {
        return config.cargar('sellauth');
    }

    get api() {
        return new SellAuthClient({
            apiKey: process.env.SELLAUTH_API_KEY,
            shopId: process.env.SELLAUTH_SHOP_ID || this.settings.shopId,
            baseUrl: this.settings.apiBaseUrl
        });
    }

    statuses() {
        const values = this.settings.announcements?.payments?.statuses;
        return Array.isArray(values) && values.length
            ? values.map(value => String(value).toLowerCase())
            : ['completed', 'partially_completed'];
    }

    icon(name) {
        return this.emojis.get(name);
    }

    async channel() {
        const id = String(this.settings.channels?.payments ?? '').trim();
        if (!id) {
            if (!this.warnedNoChannel) {
                this.warnedNoChannel = true;
                logger.warn('sellauth:payments', 'No hay canal de pagos configurado. Usa /setup channel > SellAuth payment notifications.');
            }
            return null;
        }

        this.warnedNoChannel = false;
        const channel = await this.client.channels.fetch(id).catch(() => null);
        if (!channel?.isTextBased?.()) {
            logger.warn('sellauth:payments', `El canal ${id} no existe o no admite mensajes.`);
            return null;
        }
        return channel;
    }

    isAnnounced(invoice) {
        const key = invoiceKey(invoice);
        return Boolean(key && this.db.data.announced[key]);
    }

    mark(invoice, source = 'poll') {
        const key = invoiceKey(invoice);
        if (!key) return;

        this.db.data.announced[key] = { at: Date.now(), source };
        const entries = Object.entries(this.db.data.announced)
            .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
            .slice(0, MAX_ANNOUNCED);
        this.db.data.announced = Object.fromEntries(entries);
        this.db.data.lastAnnouncedAt = Date.now();
        this.db.flush();
    }

    async alreadyInChannel(channel, invoice) {
        const id = invoiceKey(invoice);
        const unique = String(invoice?.unique_id ?? '').trim();
        if (!id && !unique) return false;

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!messages) return false;

        for (const message of messages.values()) {
            const raw = JSON.stringify(message.components?.map(component => component.toJSON?.() ?? component) ?? []);
            if ((id && raw.includes(`#${id}`)) || (unique && raw.includes(unique))) return true;
        }
        return false;
    }

    async shopBaseUrl() {
        const configured = httpsUrl(this.settings.announcements?.payments?.invoiceBaseUrl);
        if (configured) return configured.replace(/\/+$/, '');

        if (!this.shopBasePromise) {
            this.shopBasePromise = this.api.obtenerTienda()
                .then(shop => {
                    const direct = [
                        shop?.storefront_url,
                        shop?.storefrontUrl,
                        shop?.url
                    ].map(httpsUrl).find(Boolean);
                    if (direct && /mysellauth\.(?:com|test)$/i.test(new URL(direct).hostname)) {
                        return direct.replace(/\/+$/, '');
                    }

                    const subdomain = String(shop?.subdomain ?? '').trim();
                    if (/^[a-z0-9-]+$/i.test(subdomain)) {
                        return `https://${subdomain}.mysellauth.com`;
                    }
                    return '';
                })
                .catch(error => {
                    logger.warn('sellauth:payments', `No se pudo resolver el dominio de factura: ${error.message}`);
                    return '';
                });
        }

        return this.shopBasePromise;
    }

    async invoiceUrl(invoice) {
        const direct = [
            invoice?.invoice_url,
            invoice?.invoiceUrl,
            invoice?.checkout_url,
            invoice?.checkoutUrl
        ].map(httpsUrl).find(Boolean);
        if (direct) return direct;

        const unique = String(invoice?.unique_id ?? '').trim();
        if (!unique) return '';

        const template = String(this.settings.announcements?.payments?.invoiceUrlTemplate ?? '').trim();
        if (template) {
            const rendered = template
                .replaceAll('{unique_id}', encodeURIComponent(unique))
                .replaceAll('{id}', encodeURIComponent(invoiceKey(invoice)));
            const configured = httpsUrl(rendered);
            if (configured) return configured;
        }

        const base = await this.shopBaseUrl();
        return base ? `${base}/checkout/${encodeURIComponent(unique)}` : '';
    }

    paymentMethod(invoice) {
        const method = clean(
            invoice?.payment_method?.name
            || invoice?.payment_method?.checkout_name
            || invoice?.gateway,
            'Unknown'
        );
        const gateway = gatewayCode(invoice);
        if (!gateway || gateway.toLowerCase() === method.toLowerCase()) return safe(method);
        return `${safe(method)} · \`${safe(gateway)}\``;
    }

    customerText(invoice) {
        const userId = discordId(invoice);
        const userName = discordName(invoice);

        if (userId) {
            const suffix = userName ? ` · **${safe(userName)}**` : '';
            return `<@${userId}>${suffix} · \`${userId}\``;
        }
        if (userName) return `**${safe(userName)}**`;
        return 'Not linked to Discord';
    }

    async buildContainer(invoice) {
        const settings = this.settings.announcements?.payments ?? {};
        const status = clean(invoice?.status, 'processed').toLowerCase();
        const statusLabel = status
            .split('_')
            .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
            .join(' ');
        const currency = clean(invoice?.currency, 'EUR').toUpperCase();
        const priceUsd = Number(invoice?.price_usd);
        const cryptoAmount = Number(invoice?.crypto_amount);
        const gateway = gatewayCode(invoice);
        const id = invoiceKey(invoice) || '?';
        const unique = clean(invoice?.unique_id, '');
        const userId = discordId(invoice);
        const userEmail = email(invoice);
        const ts = Math.floor((completedAtMs(invoice) || Date.now()) / 1000);
        const rows = productRows(invoice);
        const invoiceLink = await this.invoiceUrl(invoice);

        const productsText = rows
            .map(row => row.quantity > 0
                ? `**${row.quantity}x** ${safe(row.name)}`
                : safe(row.name))
            .join('\n');

        const titleIcon = this.icon('money1') || this.icon('dinero');
        const productIcon = this.icon('premium') || this.icon('gift');
        const walletIcon = this.icon('wallet');
        const amountIcon = this.icon('dinero') || this.icon('money1');
        const cryptoIcon = this.icon('wallet');
        const successIcon = this.icon('success');
        const userIcon = this.icon('user') || this.icon('persona');
        const emailIcon = this.icon('notificacion');
        const invoiceIcon = this.icon('files') || this.icon('ticket');
        const referenceIcon = this.icon('link');
        const clockIcon = this.icon('clock') || this.icon('calendar');

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${titleIcon ? `${titleIcon} ` : ''}${settings.title || 'PAYMENT RECEIVED'}\n` +
                `> ${settings.description || 'SellAuth confirmed the payment and processed the invoice.'}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${productIcon ? `${productIcon} ` : ''}Order summary\n` +
                `${productsText}\n` +
                `-# Invoice #${safe(id)} · ${rows.filter(row => row.quantity > 0).reduce((sum, row) => sum + row.quantity, 0) || 1} item(s)`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `${walletIcon ? `${walletIcon} ` : ''}**Payment method:** ${this.paymentMethod(invoice)}`,
                `${amountIcon ? `${amountIcon} ` : ''}**Charged:** \`${money(invoice?.price, currency)}\``,
                ...(currency !== 'USD' && Number.isFinite(priceUsd) && priceUsd > 0
                    ? [`${amountIcon ? `${amountIcon} ` : ''}**USD value:** \`${money(priceUsd, 'USD')}\``]
                    : []),
                ...(Number.isFinite(cryptoAmount) && cryptoAmount > 0
                    ? [`${cryptoIcon ? `${cryptoIcon} ` : ''}**Crypto paid:** \`${cryptoAmount} ${safe(gateway || clean(invoice?.payment_method?.name, 'CRYPTO'))}\``]
                    : []),
                `${successIcon ? `${successIcon} ` : ''}**Status:** **${safe(statusLabel)}**`
            ].join('\n')))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `### ${userIcon ? `${userIcon} ` : ''}Customer`,
                `${userIcon ? `${userIcon} ` : ''}**Discord:** ${this.customerText(invoice)}`,
                ...(settings.showEmail !== false && userEmail
                    ? [`${emailIcon ? `${emailIcon} ` : ''}**Email:** \`${userEmail.replace(/`/g, '')}\``]
                    : [])
            ].join('\n')))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `### ${invoiceIcon ? `${invoiceIcon} ` : ''}Invoice details`,
                `${invoiceIcon ? `${invoiceIcon} ` : ''}**Invoice:** \`#${safe(id)}\``,
                ...(unique ? [`${referenceIcon ? `${referenceIcon} ` : ''}**Reference:** \`${unique.replace(/`/g, '')}\``] : []),
                `${clockIcon ? `${clockIcon} ` : ''}**Completed:** <t:${ts}:F> · <t:${ts}:R>`
            ].join('\n')));

        if (invoiceLink) {
            container
                .addSeparatorComponents(ui.linea())
                .addActionRowComponents(ui.fila(
                    ui.boton(this.emojis, {
                        url: invoiceLink,
                        etiqueta: settings.invoiceButtonLabel || 'View invoice',
                        estilo: 'enlace',
                        emoji: 'link'
                    })
                ));
        }

        container
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Spotify Market · Payment verified automatically by SellAuth`
            ));

        return {
            container,
            userId,
            method: clean(invoice?.payment_method?.name || invoice?.payment_method?.checkout_name || invoice?.gateway, 'Unknown'),
            amount: money(invoice?.price, currency),
            invoiceLink
        };
    }

    async publish(invoice, source = 'poll') {
        if (this.settings.announcements?.payments?.enabled === false) return false;
        if (this.isAnnounced(invoice)) return false;

        const channel = await this.channel();
        if (!channel) return false;

        if (await this.alreadyInChannel(channel, invoice)) {
            this.mark(invoice, 'channel-dedupe');
            return false;
        }

        const { container, userId, method, amount, invoiceLink } = await this.buildContainer(invoice);
        await channel.send({
            components: [container],
            flags: ui.V2,
            allowedMentions: userId
                ? { parse: [], users: [userId] }
                : { parse: [] }
        });

        this.mark(invoice, source);
        logger.paso(
            'sellauth:payments',
            `Pago anunciado (${source}): factura #${invoiceKey(invoice)} · ${method} · ${amount}${invoiceLink ? ' · CTA' : ''}`
        );
        return true;
    }

    async scan() {
        if (this.running) return this.running;

        this.running = (async () => {
            const channel = await this.channel();
            if (!channel || !this.api.configurado()) return 0;

            const statuses = this.statuses();
            const response = await this.api.listarFacturas({
                page: 1,
                perPage: 50,
                orderColumn: 'completed_at',
                orderDirection: 'desc',
                statuses
            });

            const invoices = (Array.isArray(response) ? response : response?.data ?? [])
                .filter(invoice => statuses.includes(String(invoice?.status ?? '').toLowerCase()))
                .sort((a, b) => completedAtMs(a) - completedAtMs(b));

            const firstRun = !this.db.data.initialized;
            const lookbackMinutes = Math.max(
                1,
                Number(this.settings.announcements?.payments?.firstRunLookbackMinutes) || DEFAULT_LOOKBACK_MIN
            );
            const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
            let published = 0;

            for (const summary of invoices) {
                const key = invoiceKey(summary);
                if (!key || this.db.data.announced[key]) continue;

                const completed = completedAtMs(summary);
                if (firstRun && completed && completed < cutoff) {
                    this.mark(summary, 'baseline');
                    continue;
                }

                const full = await this.api.obtenerFactura(key).catch(error => {
                    logger.warn('sellauth:payments', `No se pudo cargar factura #${key}: ${error.message}`);
                    return summary;
                });
                if (await this.publish(full, firstRun ? 'startup-recovery' : 'poll')) published += 1;
            }

            this.db.data.initialized = true;
            this.db.data.lastScanAt = Date.now();
            this.db.data.lastError = '';
            this.db.flush();
            if (published) logger.detalle(`Payment watcher: ${published} pago(s) recuperados.`);
            return published;
        })();

        try {
            return await this.running;
        } catch (error) {
            this.db.data.lastError = String(error.message).slice(0, 400);
            this.db.data.lastScanAt = Date.now();
            this.db.save();
            logger.error('sellauth:payments', `Payment watcher: ${error.message}`);
            return 0;
        } finally {
            this.running = null;
        }
    }

    iniciar() {
        if (this.settings.announcements?.payments?.enabled === false) return false;

        const interval = Math.max(
            15000,
            Number(this.settings.announcements?.payments?.pollIntervalMs) || DEFAULT_POLL_MS
        );
        const first = setTimeout(() => this.scan(), 2500);
        first.unref?.();
        this.timer = setInterval(() => this.scan(), interval);
        this.timer.unref?.();
        logger.paso('sellauth:payments', `watcher activo cada ${Math.round(interval / 1000)}s`);
        return true;
    }

    detener() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = SellAuthPaymentWatcher;
