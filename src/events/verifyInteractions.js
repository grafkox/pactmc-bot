const { Events } = require('discord.js');
const { handleInteraction } = require('../features/verification');

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith('verify_')) return;
        try {
            await handleInteraction(interaction);
        } catch (error) {
            console.error('[Verify] Fehler:', error);
        }
    },
};
