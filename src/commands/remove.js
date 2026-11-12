const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { removeUserFromTicket } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Entfernt einen per /add hinzugefügten User aus dem aktuellen Ticket')
        .setContexts(InteractionContextType.Guild)
        .addUserOption((option) =>
            option.setName('user').setDescription('Der User, der den Zugang zum Ticket verlieren soll').setRequired(true),
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        await removeUserFromTicket(interaction, user);
    },
};
