const { Events } = require('discord.js');
const { cleanupOnDelete } = require('../features/ticketSystem');

module.exports = {
    name: Events.ChannelDelete,

    execute(channel) {
        cleanupOnDelete(channel);
    },
};
