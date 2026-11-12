const { Events } = require('discord.js');
const { handleMention } = require('../features/mention');

module.exports = {
    name: Events.MessageCreate,

    execute(message, client) {
        handleMention(message, client).catch((error) => console.error('[Mention]', error));
    },
};
