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
    return Number.isFinite(number) ? `${number.toFixed(2)} ${code}` : `${clean(value, '0')} ${code}`;
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
    return candidates.map(v => String(v ?? '').trim()).find(v => /^\d{17,20}$/.test(v)) || '';
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
    return clean(invoice?.email || invoice?.customer?.email || invoice?.shop_customer?.email, '');
}

function productLines(invoice) {
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    if (!items.length) return ['• Purchase details unavailable'];
    const lines = items.slice(0, 8).map(item => {
        const quantity = Math.max(1, Math.trunc(Number(item?.quantity) || 1));
        const product = clean(item?.product?.name || item?.product_name, 'Product');
        const variant = clean(item?.variant?.name || item?.variant_name, '');
        const name = variant && variant !== product ? `${product} — ${variant}` : product;
        return `• **${quantity}x** ${safe(name)}`;
    });
    if (items.length > 8) lines.push(`• +${items.length - 8} more item(s)`);
    return lines;
}

class SellAuthPaymentWatcher {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('sellauth-payment-events', DB_SCHEMA);
        this.timer = null;
        this.running = null;
        this.warnedNoChannel = false;
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
            ? values.map(v => String(v).toLowerCase())
            : ['completed', 'partially_completed'];
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

    buildContainer(invoice) {
        const settings = this.settings.announcements?.payments ?? {};
        const status = clean(invoice?.status, 'processed').toLowerCase();
        const method = clean(invoice?.payment_method?.name || invoice?.payment_method?.checkout_name || invoice?.gateway, 'Unknown');
        const gateway = clean(invoice?.gateway, '');
        const methodFull = gateway && gateway.toLowerCase() !== method.toLowerCase()
            ? `${safe(method)} · \`${safe(gateway)}\``
            : safe(method);
        const currency = clean(invoice?.currency, 'EUR').toUpperCase();
        const priceUsd = Number(invoice?.price_usd);
        const cryptoAmount = Number(invoice?.crypto_amount);
        const id = invoiceKey(invoice) || '?';
        const unique = clean(invoice?.unique_id, '');
        const userId = discordId(invoice);
        const userName = discordName(invoice);
        const userEmail = email(invoice);
        const ts = Math.floor((completedAtMs(invoice) || Date.now()) / 1000);

        let customer = 'Not linked to Discord';
        if (userId) {
            customer = `<@${userId}>`;
            if (userName) customer += ` · **${safe(userName)}**`;
            customer += ` · \`${userId}\``;
        } else if (userName) {
            customer = `**${safe(userName)}**`;
        }

        const customerLines = [
            `👤 **Customer:** ${customer}`,
            ...(settings.showEmail !== false && userEmail ? [`📧 **Email:** \`${userEmail.replace(/`/g, '')}\``] : [])
        ];
        const paymentLines = [
            `💳 **Method:** ${methodFull}`,
            `💰 **Amount:** \`${money(invoice?.price, currency)}\``,
            ...(currency !== 'USD' && Number.isFinite(priceUsd) && priceUsd > 0 ? [`💵 **USD value:** \`${money(priceUsd, 'USD')}\``] : []),
            ...(Number.isFinite(cryptoAmount) && cryptoAmount > 0 && gateway ? [`🪙 **Crypto paid:** \`${cryptoAmount} ${safe(gateway)}\``] : []),
            `✅ **Status:** \`${safe(status)}\``
        ];
        const orderLines = [
            ...productLines(invoice),
            '',
            `🧾 **Invoice:** \`#${id}\``,
            ...(unique ? [`🔖 **Reference:** \`${unique.replace(/`/g, '')}\``] : []),
            `🕒 **Completed:** <t:${ts}:F> · <t:${ts}:R>`
        ];

        return {
            container: new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## 💸 ${settings.title || 'PAYMENT RECEIVED'}\n` +
                    `> ${settings.description || 'SellAuth confirmed the payment and processed the invoice.'}`
                ))
                .addSeparatorComponents(ui.linea())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(customerLines.join('\n')))
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(paymentLines.join('\n')))
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderLines.join('\n'))),
            userId,
            method,
            amount: money(invoice?.price, currency)
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

        const { container, userId, method, amount } = this.buildContainer(invoice);
        await channel.send({
            components: [container],
            flags: ui.V2,
            allowedMentions: userId ? { parse: [], users: [userId] } : { parse: [] }
        });
        this.mark(invoice, source);
        logger.paso('sellauth:payments', `Pago anunciado (${source}): factura #${invoiceKey(invoice)} · ${method} · ${amount}`);
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
            const lookbackMinutes = Math.max(1, Number(this.settings.announcements?.payments?.firstRunLookbackMinutes) || DEFAULT_LOOKBACK_MIN);
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
        const interval = Math.max(15000, Number(this.settings.announcements?.payments?.pollIntervalMs) || DEFAULT_POLL_MS);
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
