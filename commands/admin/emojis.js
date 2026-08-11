'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const ui = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emojis')
        .setDescription('Resynchronize application emojis from the emojis folder')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, { emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { creados, existentes, fallidos } = await emojis.sync();

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${emojis.rol('exito')} Emojis sincronizados`
                )
            )
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(
                ui.campos(emojis, [
                    { emoji: 'anadir', etiqueta: 'Creados', valor: String(creados) },
                    { emoji: 'info', etiqueta: 'Ya existentes', valor: String(existentes) },
                    { emoji: 'error', etiqueta: 'Fallidos', valor: String(fallidos.length) }
                ])
            );

        if (fallidos.length) {
            container.addSeparatorComponents(ui.aire());
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${fallidos.join(', ')}`)
            );
        }

        await interaction.editReply({ components: [container], flags: ui.V2 });
    }
};
