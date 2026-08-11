'use strict';

const crypto = require('node:crypto');
const { Events } = require('discord.js');

const logger = require('../utils/logger');
const ui = require('../utils/ui');

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction, client) {
        const emojis = client.emojiManager;

        try {
            if (interaction.isChatInputCommand()) {
                const comando = client.commands.get(interaction.commandName);
                if (!comando) return;

                const ahora = Date.now();
                const segundos = Number(comando.cooldown ?? 2);
                const clave = `${interaction.commandName}:${interaction.user.id}`;
                const hasta = client.cooldowns.get(clave) ?? 0;
                if (segundos > 0 && hasta > ahora) {
                    return ui.responderEfimero(interaction,
                        ui.aviso(emojis, `Please wait ${ui.duracion(hasta - ahora)} before using this command again.`));
                }
                if (segundos > 0) {
                    client.cooldowns.set(clave, ahora + segundos * 1000);
                    const limpiar = setTimeout(() => client.cooldowns.delete(clave), segundos * 1000);
                    limpiar.unref?.();
                }

                // Dependencias por objeto: anadir una nueva no rompe las firmas.
                return await comando.execute(interaction, { client, emojis, ui, logger });
            }

            if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('say_')) {
                    const say = client.commands.get('say');
                    if (interaction.isButton()) return await say?.handleButton?.(interaction);
                    if (interaction.isModalSubmit()) return await say?.handleModal?.(interaction);
                    return await say?.handleSelect?.(interaction);
                }

                const [dominio, accion, ...datos] = interaction.customId.split(':');

                // Cada modulo se registra en client al inicializarse y gestiona
                // su propio dominio, asi este enrutador no crece con las fases.
                const sistema = client.sistemas?.[dominio];
                if (!sistema || typeof sistema.handle !== 'function') return;

                return await sistema.handle(interaction, accion, datos);
            }

            if (interaction.isAutocomplete()) {
                const comando = client.commands.get(interaction.commandName);
                return await comando?.autocomplete?.(interaction, { client, emojis });
            }
        } catch (error) {
            const referencia = crypto.randomBytes(3).toString('hex').toUpperCase();
            logger.traza(`interaccion:${referencia}`, error);

            if (interaction.isAutocomplete()) {
                return interaction.respond([]).catch(() => {});
            }

            // Un fallo tambien se responde en Container, nunca en texto plano.
            const componentes = [ui.error(emojis,
                `An unexpected error occurred while processing this action.\n-# Reference \`${referencia}\``)];

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ components: componentes, flags: ui.V2_EFIMERO });
                } else {
                    await interaction.reply({ components: componentes, flags: ui.V2_EFIMERO });
                }
            } catch {
                // La interaccion ya expiro: nada que hacer.
            }
        }
    }
};
