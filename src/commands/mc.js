const { SlashCommandBuilder } = require('discord.js');
const { createBrandedEmbed } = require('../utils/embed');
const { mcHost } = require('../config');

const STATUS_API = 'https://api.mcstatus.io/v2/status/java';

async function fetchServerStatus(host) {
    const response = await fetch(`${STATUS_API}/${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
        throw new Error(`mcstatus.io HTTP ${response.status}`);
    }
    return response.json();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mc')
        .setDescription('Sehe nach, ob der PactMC Server online ist'),

    async execute(interaction, client) {
        await interaction.deferReply();
        try {
            const data = await fetchServerStatus(mcHost);

            if (!data.online) {
                throw new Error('server offline');
            }

            const embed = createBrandedEmbed(client)
                .setTitle('PactMC Minecraft Server')
                .addFields(
                    { name: 'Server Status', value: 'Der Server ist aktuell **online** :white_check_mark:' },
                    { name: 'Spielerzahl', value: data.players.online + '/' + data.players.max, inline: true },
                    { name: 'Server IP', value: '*pactmc.de*', inline: true },
                    { name: 'Website', value: '*pactmc.de*', inline: true },
                );
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            const embed = createBrandedEmbed(client)
                .setTitle('PactMC Minecraft Server')
                .addFields(
                    { name: 'Server Status', value: 'Der Server ist aktuell **offline** :x:\n\nSollte das Problem weiterhin bestehen kontaktiere bitte einen Administrator' },
                    { name: 'Server IP', value: '*pactmc.de*', inline: true },
                    { name: 'Website', value: '*pactmc.de*', inline: true },
                );
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
