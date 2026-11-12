const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { ownerRoleId, adminRoleId, modRoleId } = require('../config');
const { createBrandedEmbed } = require('../utils/embed');
const { hasAnyRole } = require('../utils/hasAnyRole');
const { setBotMode } = require('../features/ticketSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot-mode')
        .setDescription('Der Bot betreut dieses Ticket komplett ohne Antwort-Limit oder gibt es wieder ab')
        .setContexts(InteractionContextType.Guild)
        .addStringOption((option) =>
            option
                .setName('status')
                .setDescription('Bot-Modus ein- oder ausschalten')
                .setRequired(true)
                .addChoices({ name: 'an', value: 'on' }, { name: 'aus', value: 'off' }),
        ),

    async execute(interaction, client) {
        if (!hasAnyRole(interaction.member, [ownerRoleId, adminRoleId, modRoleId])) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        const enabled = interaction.options.getString('status') === 'on';
        const result = setBotMode(interaction.channel, enabled);
        if (!result.ok) {
            await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
        }

        const embed = createBrandedEmbed(client)
            .setTitle(enabled ? 'Bot-Modus aktiv' : 'Bot-Modus beendet')
            .setDescription(enabled
                ? 'Der Bot betreut dieses Ticket jetzt komplett, ohne Antwort-Limit. Nachrichten vom Team pausieren ihn nicht.'
                : 'Der Bot ist in diesem Ticket wieder pausiert, das Team übernimmt.');
        await interaction.reply({ embeds: [embed] });
    },
};
