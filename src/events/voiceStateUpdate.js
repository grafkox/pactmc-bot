const { Events } = require('discord.js');
const { supportVoiceChannelId, supportMessageChannelId, supportPingRoleIds } = require('../config');

// Pro User höchstens ein Ping in diesem Zeitraum, auch wenn er mehrfach rein und raus geht.
const COOLDOWN_MS = 2 * 60 * 1000;
// Nach einem Fehler früher wieder versuchen, aber nicht bei jedem Betreten.
const RETRY_MS = 30 * 1000;
const lastPing = new Map();

module.exports = {
    name: Events.VoiceStateUpdate,

    execute(oldState, newState, client) {
        // Nur das Betreten zählt. Mute, Deafen, Stream usw. lösen das Event auch aus, ohne den Channel zu wechseln.
        if (newState.channelId !== supportVoiceChannelId || oldState.channelId === supportVoiceChannelId) return;

        const member = newState.member;
        if (!member || member.user.bot) return;

        const now = Date.now();
        if (now - (lastPing.get(member.id) || 0) < COOLDOWN_MS) return;
        lastPing.set(member.id, now);
        for (const [id, time] of lastPing) if (now - time >= COOLDOWN_MS) lastPing.delete(id);

        const targetChannel = client.channels.cache.get(supportMessageChannelId);
        const retrySoon = () => lastPing.set(member.id, Date.now() - COOLDOWN_MS + RETRY_MS);
        if (!targetChannel) {
            retrySoon();
            console.error('Support-Ping: Channel nicht gefunden');
            return;
        }
        const rolePings = supportPingRoleIds.map((id) => `<@&${id}>`).join(', ');
        targetChannel.send({
            content: `Hey ${rolePings}! *${member.displayName}* ist nun im Support Warteraum!`,
            allowedMentions: { roles: supportPingRoleIds },
        }).catch((error) => {
            // Nicht angekommen: in 30 Sekunden wieder pingen statt erst in 2 Minuten.
            retrySoon();
            console.error('Support-Ping fehlgeschlagen:', error);
        });
    },
};
