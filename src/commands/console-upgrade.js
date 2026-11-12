const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { ownerRoleId, adminRoleId } = require('../config');
const { hasAnyRole } = require('../utils/hasAnyRole');
const { upgradeToConsole } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('console-upgrade')
        .setDescription('Stuft dieses Ticket auf Console-Zugang hoch')
        .setContexts(InteractionContextType.Guild),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ownerRoleId, adminRoleId])) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = await upgradeToConsole(interaction.channel, { by: `<@${interaction.user.id}>` });
            await interaction.editReply(result.ok ? 'Ticket wurde auf Console-Zugang hochgestuft.' : result.message);
        } catch (error) {
            console.error('[TicketSys] Console-Upgrade fehlgeschlagen:', error);
            await interaction.editReply('Das Hochstufen ist fehlgeschlagen. Details stehen im Bot-Log.');
        }
    },
};
