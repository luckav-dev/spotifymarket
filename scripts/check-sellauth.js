'use strict';

const { loadImage } = require('@napi-rs/canvas');

const SellAuthSystem = require('../modules/sellAuthSystem');
const arte = require('../utils/sellAuthArtwork');
const { objetoConsulta } = require('../utils/sellAuthClient');

async function main() {
    const system = Object.create(SellAuthSystem.prototype);
    system.client = { sistemas: {}, channels: { fetch: async () => null }, users: { fetch: async () => null } };
    system.emojis = { get: () => '', rol: () => '' };

    system.modalResena().toJSON();
    system.construirGuia().toJSON();
    system.construirResena({
        key: 'dc-1',
        source: 'discord_verified',
        sourceId: 'dc-1',
        invoiceId: '6718',
        rating: 5,
        message: 'Fast delivery, clear instructions and excellent support.',
        productName: 'Spotify Premium - 12 Months',
        userId: '',
        reply: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    }).components[0].toJSON();

    const products = SellAuthSystem.normalizarProductos([{
        id: 762,
        path: 'spotify-premium',
        name: 'Spotify Premium',
        description: '<p>Premium account with warranty.</p>',
        currency: 'EUR',
        visibility: 'public',
        products_sold: 42,
        variants: [{ id: 1368, name: '12 Months', price: '15.75', stock: 50 }],
        images: [],
        category: { name: 'Spotify' }
    }], {
        storefrontUrl: 'https://example.mysellauth.com',
        productPathTemplate: '{storefrontUrl}/product/{path}'
    });
    const product = products[0];
    if (products.length !== 1 || product.precio !== 15.75 || product.stock !== 50) {
        throw new Error('La normalizacion del catalogo SellAuth no conserva precio o stock.');
    }
    if (product.checkoutUrl !== 'https://example.mysellauth.com/product/spotify-premium') {
        throw new Error('La URL publica del producto SellAuth no se construye correctamente.');
    }

    const query = objetoConsulta({ page: 2, statuses: ['completed', 'refunded'] }).toString();
    if (!query.includes('page=2') || !query.includes('statuses%5B%5D=completed')) {
        throw new Error('Los filtros paginados de SellAuth no se serializan correctamente.');
    }

    const buffer = await arte.generarAviso({ tipo: 'restock', producto: product, titulo: 'PRODUCT RESTOCKED' });
    const image = await loadImage(buffer);
    if (image.width !== arte.ANCHO || image.height !== arte.ALTO || buffer.length < 50000) {
        throw new Error('El arte de SellAuth no tiene las dimensiones o el contenido esperado.');
    }

    console.log(`ok SellAuth: modal, guia, reseña, catalogo y arte ${image.width}x${image.height}`);
}

main().catch(error => {
    console.error(`x SellAuth smoke: ${error.message}`);
    process.exit(1);
});
