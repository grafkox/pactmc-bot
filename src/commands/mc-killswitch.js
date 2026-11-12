const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { ticketSystem } = require('../config');
const { createBrandedEmbed } = require('../utils/embed');
const { isOwner } = require('../utils/isOwner');
const store = require('../features/ticketSystem/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mc-killswitch')
        .setDescription('Schaltet den Console-Zugang des Bots global ein oder aus (ohne Option: Status anzeigen)')
        .setContexts(InteractionContextType.Guild)
        .addStringOption((option) =>
            option
                .setName('zustand')
                .setDescription('Neuer Zustand des Console-Zugangs')
                .addChoices(
                    { name: 'Console-Zugang aktiv', value: 'enabled' },
                    { name: 'Console-Zugang aus (Killswitch)', value: 'disabled' },
                ),
        ),

    async execute(interaction, client) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        const wanted = interaction.options.getString('zustand');
        const describe = () => (store.getCommandsEnabled()
            ? 'Der Console-Zugang ist aktiv.'
            : 'Der Console-Zugang ist ausgeschaltet (Killswitch aktiv).');

        if (!wanted) {
            await interaction.reply({ content: describe(), flags: MessageFlags.Ephemeral });
            return;
        }

        store.setCommandsEnabled(wanted === 'enabled');
        await interaction.reply({ content: describe(), flags: MessageFlags.Ephemeral });

        const channel = await client.channels.fetch(ticketSystem.auditChannelId).catch(() => null);
        if (channel?.isTextBased()) {
            const embed = createBrandedEmbed(client)
                .setTitle('Killswitch geändert')
                .setDescription(`${describe()}\nGeändert von <@${interaction.user.id}>.`);
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    },
};
