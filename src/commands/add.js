const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { addUserToTicket } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Fügt einen User zum aktuellen Ticket hinzu')
        .setContexts(InteractionContextType.Guild)
        .addUserOption((option) =>
            option.setName('user').setDescription('Der User, der Zugang zum Ticket bekommen soll').setRequired(true),
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        await addUserToTicket(interaction, user);
    },
};
