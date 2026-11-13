const { Events, MessageFlags } = require('discord.js');
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
            const reply = { content: 'Dabei ist ein Fehler aufgetreten. Versuch es bitte nochmal.', flags: MessageFlags.Ephemeral };
            const send = interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply);
            await send.catch(() => {});
        }
    },
};
