const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType } = require('discord.js');
const { isOwner } = require('../utils/isOwner');
const { postTicketPanel } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('Postet das Ticket-Panel mit den Öffnen-Buttons in diesen Channel')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }
        await postTicketPanel(interaction);
    },
};
