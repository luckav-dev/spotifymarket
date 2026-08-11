'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const config = require('../../utils/config');
const ui = require('../../utils/ui');

const ACTIONS = [
    { name: 'Add a product', value: 'add' },
    { name: 'Edit a product', value: 'edit' },
    { name: 'Delete a product', value: 'delete' },
    { name: 'Change product visibility', value: 'visibility' },
    { name: 'List the complete catalog', value: 'list' }
];
const LIMIT = 25;
const LIST_BUDGET = 3400;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('product')
        .setDescription('Manage the entire product catalog from one command')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => option
            .setName('action')
            .setDescription('Catalog action to perform')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(option => option
            .setName('product')
            .setDescription('Existing product; required for edit, delete and visibility')
            .setAutocomplete(true))
        .addStringOption(option => option
            .setName('category')
            .setDescription('Product category; required when adding')
            .setAutocomplete(true))
        .addBooleanOption(option => option
            .setName('visible')
            .setDescription('Whether the selected product is visible in the catalog')),

    async autocomplete(interaction, { client }) {
        const focused = interaction.options.getFocused(true);
        const query = String(focused.value || '').toLowerCase();

        if (focused.name === 'action') {
            return interaction.respond(ACTIONS
                .filter(item => item.name.toLowerCase().includes(query) || item.value.includes(query))
                .map(item => ({ name: item.name, value: item.value })));
        }
        if (focused.name === 'category') {
            return interaction.respond(config.cargar('shop').categorias
                .filter(category => category.toLowerCase().includes(query))
                .slice(0, LIMIT)
                .map(category => ({ name: category, value: category })));
        }

        const products = Object.values(client.sistemas.shop.db.data.productos)
            .filter(product => product.nombre.toLowerCase().includes(query) || product.id.toLowerCase().includes(query))
            .slice(0, LIMIT);
        return interaction.respond(products.map(product => ({
            name: `${product.nombre} · ${product.categoria}${product.visible ? '' : ' · hidden'}`.slice(0, 100),
            value: product.id
        })));
    },

    async execute(interaction, { client, emojis }) {
        const shop = client.sistemas.shop;
        const action = interaction.options.getString('action');
        const productId = interaction.options.getString('product');
        const category = interaction.options.getString('category');
        const visible = interaction.options.getBoolean('visible');

        if (!ACTIONS.some(item => item.value === action)) {
            return interaction.reply({ components: [ui.error(emojis, 'Select a valid catalog action from autocomplete.')], flags: ui.V2_EFIMERO });
        }

        if (action === 'add') {
            const index = config.cargar('shop').categorias.indexOf(category);
            if (index === -1) {
                return interaction.reply({ components: [ui.error(emojis, 'Choose a valid category when adding a product.')], flags: ui.V2_EFIMERO });
            }
            return interaction.showModal(shop.modalProducto(null, index));
        }

        if (action === 'edit') {
            const product = shop.db.data.productos[productId];
            if (!product) {
                return interaction.reply({ components: [ui.error(emojis, 'Choose an existing product to edit.')], flags: ui.V2_EFIMERO });
            }
            return interaction.showModal(shop.modalProducto(product));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (action === 'delete') {
            if (!productId) return interaction.editReply({ components: [ui.error(emojis, 'Choose the product to delete.')], flags: ui.V2 });
            const product = await shop.eliminar(productId);
            return interaction.editReply({
                components: [product ? ui.exito(emojis, `**${product.nombre}** eliminado del catálogo.`) : ui.error(emojis, 'That product no longer exists.')],
                flags: ui.V2
            });
        }

        if (action === 'visibility') {
            if (!productId || visible === null) {
                return interaction.editReply({ components: [ui.error(emojis, 'Choose a product and set the visible option.')], flags: ui.V2 });
            }
            const product = await shop.editar(productId, { visible });
            return interaction.editReply({
                components: [product
                    ? ui.exito(emojis, `**${product.nombre}** ahora está ${visible ? 'publicado' : 'oculto'}.`)
                    : ui.error(emojis, 'That product no longer exists.')],
                flags: ui.V2
            });
        }

        const products = Object.values(shop.db.data.productos);
        if (!products.length) {
            return interaction.editReply({ components: [ui.info(emojis, 'El catálogo está vacío. Usa `/product action:add category:...`.')], flags: ui.V2 });
        }

        const ordered = [...products].sort((a, b) => a.nombre.localeCompare(b.nombre));
        const lines = [];
        let used = 0;
        for (const product of ordered) {
            const line = `${product.visible ? emojis.rol('exito') : emojis.rol('cancelar')} **${product.nombre}** · ${shop.precioTexto(product)}\n-# \`${product.id}\` · ${product.categoria} · ${shop.stockTexto(product)}`;
            if (used + line.length > LIST_BUDGET) break;
            lines.push(line);
            used += line.length;
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${emojis.get('bots')} Catálogo completo\n\n` +
                `${emojis.rol('info')} ${products.length} productos · ${products.filter(product => product.visible).length} visibles · ${products.filter(product => !product.visible).length} ocultos`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
        if (lines.length < ordered.length) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ordered.length - lines.length} productos adicionales no caben en esta página.`));
        }
        return interaction.editReply({ components: [container], flags: ui.V2 });
    }
};
