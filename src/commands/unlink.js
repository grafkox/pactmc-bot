const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { ownerRoleId, adminRoleId, modLeitungRoleId, modRoleId, ticketSystem } = require('../config');
const { createBrandedEmbed } = require('../utils/embed');
const { hasAnyRole } = require('../utils/hasAnyRole');
const store = require('../features/ticketSystem/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Hebt die Verknüpfung eines Users mit seinem bestätigten Ingame-Namen auf')
        .setContexts(InteractionContextType.Guild)
        .addUserOption((option) =>
            option.setName('user').setDescription('Der User, dessen Ingame-Name neu bestätigt werden muss').setRequired(true),
        ),

    async execute(interaction, client) {
        if (!hasAnyRole(interaction.member, [ownerRoleId, adminRoleId, modLeitungRoleId, modRoleId])) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        const user = interaction.options.getUser('user');
        const link = store.getLink(user.id);
        if (!store.removeLink(user.id)) {
            await interaction.reply({ content: `${user} hat keinen bestätigten Ingame-Namen.`, flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.reply({
            content: `Verknüpfung aufgehoben: ${user} war mit **${link.name}** verknüpft und muss sich beim nächsten Mal neu bestätigen.`,
            flags: MessageFlags.Ephemeral,
        });

        const channel = await client.channels.fetch(ticketSystem.auditChannelId).catch(() => null);
        if (channel?.isTextBased()) {
            const embed = createBrandedEmbed(client)
                .setTitle('Ingame-Verknüpfung aufgehoben')
                .setDescription(`${user} war mit **${link.name}** verknüpft.\nAufgehoben von <@${interaction.user.id}>.`);
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    },
};
