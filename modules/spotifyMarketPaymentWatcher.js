'use strict';

const SellAuthPaymentWatcher = require('./sellAuthPaymentWatcher');
const logger = require('../utils/logger');

const DEFAULT_WEB_URL = 'https://spotifymarket.xyz';

class SpotifyMarketPaymentWatcher extends SellAuthPaymentWatcher {
    get settings() {
        const settings = super.settings;
        return {
            ...settings,
            announcements: {
                ...(settings.announcements ?? {}),
                payments: {
                    ...(settings.announcements?.payments ?? {}),
                    invoiceButtonLabel: 'View order'
                }
            }
        };
    }

    async invoiceUrl(invoice) {
        const id = String(invoice?.id ?? '').trim();
        if (id && typeof this.api.crearEnlaceFactura === 'function') {
            try {
                const url = await this.api.crearEnlaceFactura(id);
                if (/^https:\/\//i.test(url)) return url;
            } catch (error) {
                logger.warn('sellauth:payments', `No se pudo crear el enlace privado del pedido #${id}: ${error.message}`);
            }
        }

        const base = String(process.env.SPOTIFY_MARKET_WEB_URL || DEFAULT_WEB_URL).trim().replace(/\/+$/, '');
        return `${base}/account`;
    }
}

module.exports = SpotifyMarketPaymentWatcher;
