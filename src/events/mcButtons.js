const { Events } = require('discord.js');
const { handleConfirmButton } = require('../features/mcCommands/confirm');

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('mc_confirm:')) return;
        try {
            await handleConfirmButton(interaction);
        } catch (error) {
            console.error('[MC] Bestätigungs-Fehler:', error);
        }
    },
};
