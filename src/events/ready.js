const { Events } = require('discord.js');
const { statusArray } = require('../config');

async function pickPresence(client) {
    const option = Math.floor(Math.random() * statusArray.length);
    try {
        await client.user.setActivity({
            name: statusArray[option].name,
            type: statusArray[option].type,
            status: statusArray[option].status,
        });
    } catch (error) {
        console.error(error);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,

    execute(readyClient) {
        console.log('Bot is ready!');

        pickPresence(readyClient);
        setInterval(() => pickPresence(readyClient), 30 * 1000);
    },
};
