const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { ticketSystem } = require('../config');
const { createBrandedEmbed } = require('../utils/embed');
const { isOwner } = require('../utils/isOwner');
const { PROFILES } = require('../features/mcCommands/policy');
const store = require('../features/ticketSystem/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mc-policy')
        .setDescription('Wählt das Policy-Profil für Server-Befehle des Bots (ohne Option: Status anzeigen)')
        .setContexts(InteractionContextType.Guild)
        .addStringOption((option) =>
            option
                .setName('profil')
                .setDescription('Wie viel der Bot ohne Bestätigung ausführen darf')
                .addChoices(
                    { name: 'open: alles außer Blocklist automatisch', value: 'open' },
                    { name: 'guarded: privilegierte Befehle brauchen Bestätigung', value: 'guarded' },
                    { name: 'locked: jeder Befehl braucht Bestätigung', value: 'locked' },
                ),
        ),

    async execute(interaction, client) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        const wanted = interaction.options.getString('profil');
        if (wanted) store.setPolicyProfile(wanted);

        const current = store.getPolicyProfile();
        const description = PROFILES[current]?.description || 'Unbekanntes Profil, es gilt "locked".';
        const text = `Aktives Profil: ${current}\n${description}\nDie Blocklist gilt in jedem Profil, und der Supervisor prüft jeden Befehl.`;
        await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });

        if (!wanted) return;
        const channel = await client.channels.fetch(ticketSystem.auditChannelId).catch(() => null);
        if (channel?.isTextBased()) {
            const embed = createBrandedEmbed(client)
                .setTitle('Policy-Profil geändert')
                .setDescription(`Neues Profil: ${current}\nGeändert von <@${interaction.user.id}>.`);
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    },
};
