const { Events } = require('discord.js');
const { prefix } = require('../config');
const { isOwner } = require('../utils/isOwner');

function handleDm(message, args) {
    if (!isOwner(message.member)) {
        message.channel.send('Du hast nicht die Berechtigung diesen Befehl zu nutzen!');
        return;
    }

    const user = message.mentions.users.first();
    if (!user) {
        message.channel.send('Du hast keinen User angegeben!');
        return;
    }

    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        message.channel.send('Der User ist nicht auf diesem Server!');
        return;
    }

    const text = args.join(' ').replace(/<@!?\d+>\s*/, '').trim();
    if (!text) {
        message.channel.send('Du hast keinen Text angegeben!');
        return;
    }

    member.send(text)
        .then(() => message.channel.send('Nachricht erfolgreich gesendet!'))
        .catch(() => message.channel.send('Der User nimmt keine Direktnachrichten an.'));
}

function handleMessage(message, args) {
    if (!isOwner(message.member)) {
        message.channel.send('Du hast nicht die Berechtigung diesen Befehl zu nutzen!');
        return;
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
        message.channel.send('Du hast keinen Channel angegeben!');
        return;
    }

    const text = args.join(' ').replace(/<#\d+>\s*/, '').trim();
    if (!text) {
        message.channel.send('Du hast keinen Text angegeben!');
        return;
    }

    channel.send(text).catch((error) => console.error('!message fehlgeschlagen:', error));
}

module.exports = {
    name: Events.MessageCreate,

    execute(message) {
        if (!message.content.startsWith(prefix) || message.author.bot) return;

        const messageArray = message.content.split(' ');
        const command = messageArray[0].slice(prefix.length).toLowerCase();
        const args = messageArray.slice(1);

        if (command === 'dm') {
            handleDm(message, args);
        } else if (command === 'message') {
            handleMessage(message, args);
        }
    },
};
