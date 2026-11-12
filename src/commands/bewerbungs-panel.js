const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType } = require('discord.js');
const { isOwner } = require('../utils/isOwner');
const { postBewerbungPanel } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bewerbungs-panel')
        .setDescription('Postet das Bewerbungs-Panel mit Button in diesen Channel')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }
        await postBewerbungPanel(interaction);
    },
};
