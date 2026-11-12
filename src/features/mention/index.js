const { ticketSystem, ticketAssistant, modRoleId } = require('../../config');
const { runMention } = require('../ticketAssistant/openwebui');
const log = require('../ticketAssistant/log');
const { hasAnyRole } = require('../../utils/hasAnyRole');
const { hit } = require('../mcCommands/ratelimit');

const mention = ticketSystem.mention;
const MAX_IMAGES = ticketAssistant.maxImagesPerBatch || 4;

// Alle offenen Ticket-Kategorien, um Ticket-Channels zu erkennen.
const ticketCategoryIds = [
    ...new Set([
        ...Object.values(ticketSystem.types).map((t) => t.categoryOpen),
        ticketSystem.consoleCategoryOpen,
    ]),
];

// Nur bei ausdrücklichem Wunsch nach einem Menschen wird das Team gepingt.
const HUMAN_REQUEST = /(echte[rn]? (mensch|person)|mit (einem|nem|einer) (menschen|mitarbeiter|teammitglied)|mitarbeiter|teammitglied|jemand vom team|ans team|kein bot|richtige[rn]? (person|mensch)|mensch(en)? (sprechen|reden|schreiben))/i;

function isTicketChannel(channel) {
    return Boolean(channel?.parentId && ticketCategoryIds.includes(channel.parentId));
}

function isAllowed(message) {
    if (isTicketChannel(message.channel)) return true; // in Tickets darf jeder
    if (mention.extraChannels.includes(message.channel.id)) return hasAnyRole(message.member, mention.staffRoles);
    return false;
}

function cleanContent(message, botId) {
    return message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').replace(/\s+/g, ' ').trim();
}

async function fetchImages(message) {
    const out = [];
    const images = [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
    for (const att of images) {
        if (out.length >= MAX_IMAGES) break;
        if (att.size > ticketAssistant.maxImageBytes) continue;
        try {
            const res = await fetch(att.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            out.push({ dataUrl: `data:${att.contentType || 'image/png'};base64,${buffer.toString('base64')}` });
        } catch (error) {
            log.error(`Mention-Bild nicht ladbar (${att.url}):`, error);
        }
    }
    return out;
}

// Letzte N Nachrichten, aber keine älter als contextHours (was zuerst greift).
async function buildContext(channel, botId) {
    const cutoff = Date.now() - mention.contextHours * 3600 * 1000;
    const fetched = await channel.messages.fetch({ limit: mention.contextMessages });
    const ordered = [...fetched.values()]
        .filter((m) => m.createdTimestamp >= cutoff)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const history = [];
    for (const m of ordered) {
        if (m.author.id === botId) {
            const text = m.content?.trim() || m.embeds.map((e) => e.description || '').filter(Boolean).join('\n');
            if (text) history.push({ role: 'assistant', content: text });
            continue;
        }
        if (m.author.bot) continue;
        const text = cleanContent(m, botId);
        if (text) history.push({ role: 'user', content: `${m.author.username}: ${text}` });
    }
    return history;
}

async function handleMention(message, client) {
    const { openWebUi } = ticketAssistant;
    if (!openWebUi.baseUrl || !openWebUi.apiKey) return;
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.mentions.users.has(client.user.id)) return;
    if (!isAllowed(message)) return;

    const channel = message.channel;
    // Jede Erwähnung kostet einen Modell-Aufruf, deshalb begrenzt pro User und pro Channel.
    if (!hit(`mention:user:${message.author.id}`, 5) || !hit(`mention:channel:${channel.id}`, 10)) {
        log.warn(`#${channel.name} | @mention ignoriert, Rate-Limit (${message.author.username})`);
        return;
    }
    await channel.sendTyping().catch(() => {});

    const history = await buildContext(channel, client.user.id);
    const images = await fetchImages(message);

    let result;
    try {
        result = await runMention(history, images);
    } catch (error) {
        log.error(`Mention-Fehler in #${channel.name}:`, error);
        return;
    }

    const text = result.response
        || 'Dazu hab ich gerade keine sichere Info. Wenn du ein Teammitglied brauchst, sag einfach kurz Bescheid.';
    await channel.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });

    // Staff-Ping nur bei ausdrücklichem Wunsch nach einem Menschen und nur in Ticket-Channels.
    if (isTicketChannel(channel) && HUMAN_REQUEST.test(cleanContent(message, client.user.id))) {
        await channel.send({ content: `<@&${modRoleId}>`, allowedMentions: { roles: [modRoleId] } }).catch(() => {});
    }
    log.info(`#${channel.name} | @mention beantwortet (${history.length} Kontext, ${images.length} Bild)`);
}

module.exports = { handleMention };
