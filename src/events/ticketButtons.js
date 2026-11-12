const { Events } = require('discord.js');
const { handleButton } = require('../features/ticketSystem');

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('ticket_')) return;
        try {
            await handleButton(interaction);
        } catch (error) {
            console.error('[TicketSys] Button-Fehler:', error);
        }
    },
};
