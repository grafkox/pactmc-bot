const { Events, MessageFlags } = require('discord.js');

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`Fehler in /${interaction.commandName}:`, error);
            const reply = { content: 'Dabei ist ein Fehler aufgetreten.', flags: MessageFlags.Ephemeral };
            const send = interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply);
            await send.catch(() => {});
        }
    },
};
