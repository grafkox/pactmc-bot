const { Events } = require('discord.js');
const { prefix } = require('../config');
const { isOwner } = require('../utils/isOwner');

// Antwort im Channel, Fehler (z.B. fehlende Rechte) nur loggen.
function answer(message, text) {
    return message.channel.send(text).catch((error) => console.error('Antwort fehlgeschlagen:', error.message));
}

async function handleDm(message, args) {
    if (!isOwner(message.member)) {
        answer(message, 'Du hast nicht die Berechtigung diesen Befehl zu nutzen!');
        return;
    }

    const user = message.mentions.users.first();
    if (!user) {
        answer(message, 'Du hast keinen User angegeben!');
        return;
    }

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
        answer(message, 'Der User ist nicht auf diesem Server!');
        return;
    }

    const text = args.join(' ').replace(/<@!?\d+>\s*/, '').trim();
    if (!text) {
        answer(message, 'Du hast keinen Text angegeben!');
        return;
    }

    try {
        await member.send(text);
    } catch {
        await answer(message, 'Der User nimmt keine Direktnachrichten an.');
        return;
    }
    await answer(message, 'Nachricht erfolgreich gesendet!');
}

function handleMessage(message, args) {
    if (!isOwner(message.member)) {
        answer(message, 'Du hast nicht die Berechtigung diesen Befehl zu nutzen!');
        return;
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
        answer(message, 'Du hast keinen Channel angegeben!');
        return;
    }
    if (!channel.isTextBased?.()) {
        answer(message, 'In diesen Channel kann ich nicht schreiben!');
        return;
    }

    const text = args.join(' ').replace(/<#\d+>\s*/, '').trim();
    if (!text) {
        answer(message, 'Du hast keinen Text angegeben!');
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
            handleDm(message, args).catch((error) => console.error('!dm fehlgeschlagen:', error));
        } else if (command === 'message') {
            handleMessage(message, args);
        }
    },
};
