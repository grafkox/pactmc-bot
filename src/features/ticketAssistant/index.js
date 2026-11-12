const { ticketAssistant, ticketSystem, mcCommands } = require('../../config');
const { TicketStatus, ensureTicket, getTicket, setStatus, clearTicket } = require('./state');
const { runAnswer } = require('./openwebui');
const { decideGate, gateLabel } = require('./gate');
const { escalate } = require('./escalation');
const { runAction, neutralize } = require('./actions');
const store = require('../ticketSystem/store');
const { canUpgrade, upgradeToConsole } = require('../ticketSystem');
const { hasAnyRole } = require('../../utils/hasAnyRole');
const verification = require('../verification');
const { hit } = require('../mcCommands/ratelimit');
const log = require('./log');

const DISCORD_MESSAGE_LIMIT = 2000;
// Ohne Antwort-Limit (Console, Bot-Modus) begrenzt das die Modell-Aufrufe pro Ticket.
const BATCH_LIMIT = 20;
const BATCH_WINDOW_MS = 10 * 60 * 1000;

function isConfigured() {
    const { enabled, ticketCategoryIds, openWebUi } = ticketAssistant;
    return Boolean(enabled && openWebUi.baseUrl && openWebUi.apiKey && ticketCategoryIds.length);
}

// Registrierte Tickets, sonst Channels in den konfigurierten Kategorien.
function ticketInfo(channel) {
    const stored = store.getTicket(channel?.id);
    if (stored) return stored;
    if (channel?.parentId && ticketAssistant.ticketCategoryIds.includes(channel.parentId)) {
        return { type: 'general', mode: 'normal', status: 'open' };
    }
    return null;
}

// Bewerbungen betreut der Bot nicht automatisch, dort funktioniert nur die @-Erwähnung.
function isActive(info) {
    return Boolean(info) && info.status !== 'closed' && info.type !== 'bewerbung';
}

const isConsole = (info) => info.mode === 'console';
const isUnlimited = (info) => isConsole(info) || Boolean(info.botMode);
const pauseRoles = (info) => (isConsole(info) ? ticketSystem.consoleAccessRoles : ticketAssistant.pauseRoleIds);
const pingRoles = (info) => (isConsole(info) ? ticketSystem.consoleAccessRoles : ticketAssistant.supportRoleIds);

// Antworten auf Slash-Commands und Buttons (z.B. /add) sind keine Antworten des Assistenten.
function isPlainBotReply(msg) {
    if (msg.interactionMetadata || msg.interaction) return false;
    return Boolean(msg.content?.trim()) && msg.embeds.length === 0 && msg.components.length === 0;
}

// Nach einem Neustart fehlt bei alten Nachrichten oft das Member-Objekt. Ohne Rollen würde eine
// Team-Nachricht wie eine Spieler-Nachricht aussehen, deshalb werden fehlende Member nachgeladen.
async function resolveMembers(channel, messages) {
    const missing = [...new Set(messages.filter((m) => !m.author.bot && !m.member).map((m) => m.author.id))];
    const members = new Map();
    for (const id of missing.slice(0, 25)) {
        const member = await channel.guild?.members.fetch(id).catch(() => null);
        if (member) members.set(id, member);
    }
    return members;
}

// Hinweise, die das Antwortmodell zum Console-Zugang bekommt.
function notesFor(info) {
    if (!isConsole(info)) return [];
    return [store.getCommandsEnabled()
        ? '[[CONSOLE-STATUS]] Der Console-Zugang ist aktiv.'
        : '[[CONSOLE-STATUS]] Der Console-Zugang ist per Killswitch deaktiviert. Schlage keine Befehle vor.'];
}

function handleTicketChannelCreate(channel) {
    if (!isConfigured() || !ticketInfo(channel)) return;
    ensureTicket(channel.id);
    log.info(`#${channel.name} | Ticket erkannt`);
}

function handleTicketChannelDelete(channel) {
    if (getTicket(channel?.id)) {
        clearTicket(channel.id);
        log.info(`#${channel.name} | geschlossen`);
    }
}

function schedule(channel, client, ticket) {
    if (ticket.debounceTimer) clearTimeout(ticket.debounceTimer);
    ticket.debounceTimer = setTimeout(() => {
        ticket.debounceTimer = null;
        processTicketBatch(channel, client).catch((error) => log.error(`#${channel.name} | Batch-Fehler:`, error));
    }, ticketAssistant.debounceSeconds * 1000);
}

async function handleTicketMessage(message, client) {
    if (!isConfigured()) return;
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.mentions.users.has(client.user.id)) return; // @mention wird vom Mention-Feature behandelt

    const channel = message.channel;
    const info = ticketInfo(channel);
    if (!isActive(info)) return;

    // Code-Eingaben für die Namensbestätigung gehen nicht an die KI.
    if (await verification.handleMessage(message)) return;

    const ticket = ensureTicket(channel.id);
    if (info.paused && ticket.status !== TicketStatus.PAUSED_HUMAN) {
        setStatus(channel.id, TicketStatus.PAUSED_HUMAN);
    }

    // Team schreibt: Bot pausiert, außer der Bot-Modus ist an. Nur beim Wechsel loggen.
    if (hasAnyRole(message.member, pauseRoles(info))) {
        if (info.botMode) return;
        if (ticket.status !== TicketStatus.PAUSED_HUMAN) {
            if (ticket.debounceTimer) clearTimeout(ticket.debounceTimer);
            ticket.debounceTimer = null;
            setStatus(channel.id, TicketStatus.PAUSED_HUMAN);
            log.info(`#${channel.name} | Takeover (${message.author.username})`);
        }
        return;
    }

    if (ticket.status === TicketStatus.PAUSED_HUMAN || ticket.status === TicketStatus.ESCALATED) return;

    ticket.lastUserId = message.author.id;

    if (ticketAssistant.verbose) {
        const imgNote = message.attachments.size ? ` [+${message.attachments.size} Anhang]` : '';
        log.info(`#${channel.name} | ${message.author.username}: "${log.truncate(message.content, 100)}"${imgNote}`);
    }

    // Bilder sofort laden, die signierten Attachment-URLs laufen ab.
    await collectImages(message, ticket);
    schedule(channel, client, ticket);
}

async function collectImages(message, ticket) {
    const images = [...message.attachments.values()].filter((att) => att.contentType?.startsWith('image/'));
    for (const att of images) {
        if (ticket.pendingImages.length >= ticketAssistant.maxImagesPerBatch) break;
        if (att.size > ticketAssistant.maxImageBytes) {
            log.warn(`#${message.channel.name} | Bild übersprungen, zu groß (${Math.round(att.size / 1024 / 1024)} MB)`);
            continue;
        }
        try {
            const res = await fetch(att.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            const mediaType = att.contentType || 'image/png';
            ticket.pendingImages.push({ dataUrl: `data:${mediaType};base64,${buffer.toString('base64')}` });
        } catch (error) {
            log.error(`#${message.channel.name} | Bild nicht ladbar (${att.url}):`, error);
        }
    }
}

async function buildHistory(channel, client, info) {
    const fetched = await channel.messages.fetch({ limit: 50 });
    const ordered = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const staffRoles = pauseRoles(info);
    const resumedAt = info.resumedAt || 0;
    const members = await resolveMembers(channel, ordered);

    const history = [];
    let staffPresent = false;
    let botReplies = 0;

    for (const msg of ordered) {
        if (msg.author.id === client.user.id) {
            // Willkommens-, Eskalations- und Statusnachrichten sind Embeds und zählen nicht.
            if (isPlainBotReply(msg)) {
                botReplies += 1;
                history.push({ role: 'assistant', content: msg.content.trim() });
            }
            continue;
        }
        if (msg.author.bot) continue;

        const text = neutralize(msg.content?.trim() || '');
        if (!text && msg.attachments.size === 0) continue;
        if (/^\d{6}$/.test(text)) continue; // Bestätigungscodes gehören nicht in den KI-Kontext

        if (hasAnyRole(msg.member || members.get(msg.author.id), staffRoles)) {
            if (msg.createdTimestamp > resumedAt) staffPresent = true;
            history.push({ role: 'user', content: `[Staff] ${text}`.trim() });
        } else {
            history.push({ role: 'user', content: text || '(Anhang ohne Text)' });
        }
    }

    return { history, staffPresent, botReplies };
}

// Läuft immer nur ein Batch pro Ticket. Nachrichten, die währenddessen kommen, lösen danach einen neuen aus.
async function processTicketBatch(channel, client) {
    const ticket = getTicket(channel.id);
    if (!ticket) return;
    if (ticket.busy) {
        ticket.rerun = true;
        return;
    }

    ticket.busy = true;
    try {
        await runBatch(channel, client, ticket);
    } finally {
        ticket.busy = false;
        if (ticket.rerun) {
            ticket.rerun = false;
            schedule(channel, client, ticket);
        }
    }
}

// Antwortmodell aufrufen. Schlägt es Aktionen vor (Befehl, Logs), werden sie ausgeführt und
// das Ergebnis geht zurück ans Modell, bis es antwortet oder das Zyklus-Limit erreicht ist.
async function answerWithActions({ channel, client, info, ticket, history, images, tag }) {
    const notes = notesFor(info);
    const userTurns = history.filter((m) => m.role === 'user' && typeof m.content === 'string');
    const excerpts = userTurns.filter((m) => !m.content.startsWith('[Staff]')).slice(-2).map((m) => m.content);
    const staffExcerpts = userTurns.filter((m) => m.content.startsWith('[Staff]')).slice(-2).map((m) => m.content.replace(/^\[Staff\]\s*/, ''));
    let convo = history;
    let current = await runAnswer(convo, images, { notes });
    let sent = 0;

    for (let cycle = 0; current.action && cycle < mcCommands.maxCycles; cycle++) {
        if (current.response) {
            await sendAnswer(channel, current.response);
            sent += 1;
        }
        const userId = ticket.lastUserId || info.opener || 'unbekannt';
        const step = await runAction({ action: current.action, channel, client, info, userId, excerpts, staffExcerpts });
        log.info(`${tag} | Aktion ${current.action.type}: ${step.status}`);
        convo = [...convo, { role: 'assistant', content: current.raw }, { role: 'user', content: step.text }];
        current = await runAnswer(convo, [], { notes });
    }

    return { answer: current, sent, exhausted: Boolean(current.action) };
}

async function runBatch(channel, client, ticket) {
    if (ticket.status === TicketStatus.PAUSED_HUMAN || ticket.status === TicketStatus.ESCALATED) return;

    const info = ticketInfo(channel);
    if (!isActive(info)) return;

    const tag = `#${channel.name}${info.botMode ? ' [bot-mode]' : ''}`;
    const { answerModel } = ticketAssistant.openWebUi;
    const max = ticketAssistant.maxAutoReplies;
    const unlimited = isUnlimited(info);
    const roleIds = pingRoles(info);

    const { history, staffPresent, botReplies } = await buildHistory(channel, client, info);

    if (staffPresent && !info.botMode) {
        setStatus(channel.id, TicketStatus.PAUSED_HUMAN);
        log.info(`${tag} | Staff aktiv, pausiert`);
        return;
    }

    // Loop-Guard, aus dem Verlauf rekonstruiert, damit er einen Neustart übersteht.
    if (!unlimited) {
        ticket.autoReplies = Math.max(ticket.autoReplies, botReplies);
        if (ticket.autoReplies >= max) {
            log.info(`${tag} | Limit ${ticket.autoReplies}/${max}, eskaliert`);
            await escalate(channel, 'Antwort-Limit erreicht, bitte übernehmen.', client, roleIds);
            return;
        }
    }

    if (!history.length) return;

    if (unlimited && !hit(`batch:${channel.id}`, BATCH_LIMIT, BATCH_WINDOW_MS)) {
        log.warn(`${tag} | zu viele Anfragen in kurzer Zeit, eskaliert`);
        await escalate(channel, 'Ungewöhnlich viele Nachrichten in kurzer Zeit, bitte übernehmen.', client, roleIds);
        return;
    }

    const images = ticket.pendingImages;
    const imgPart = images.length ? ` [${images.length} Bild]` : '';

    let gate;
    const tGate = Date.now();
    try {
        gate = await decideGate(history, { imageCount: images.length, tag });
    } catch (error) {
        log.error(`${tag} | ${gateLabel()} Fehler, eskaliert:`, error);
        await escalate(channel, 'Interner Fehler bei der Vorprüfung.', client, roleIds);
        return;
    }
    const gMs = ((Date.now() - tGate) / 1000).toFixed(1);

    // Console und Bot-Modus: Das Antwortmodell entscheidet über Eskalationen, nicht das Gate.
    if (gate.escalate && unlimited) {
        log.info(`${tag} | ${gate.source} will eskalieren, ignoriert (Console/Bot-Modus)`);
        gate = { ...gate, escalate: false, should_respond: true };
    }

    if (gate.escalate) {
        log.info(`${tag}${imgPart} | ${gate.source} eskaliert (${gMs}s) | "${log.truncate(gate.reason, 140)}"`);
        await escalate(channel, gate.reason || 'Fall sollte von einem Menschen geprüft werden.', client, roleIds);
        return;
    }
    if (!gate.should_respond) {
        // Bewusst still, Bilder bleiben für den nächsten Batch gepuffert.
        setStatus(channel.id, TicketStatus.ACTIVE_BOT);
        log.info(`${tag}${imgPart} | ${gate.source} still (${gMs}s)`);
        return;
    }

    let outcome;
    const tAns = Date.now();
    try {
        outcome = await answerWithActions({ channel, client, info, ticket, history, images, tag });
    } catch (error) {
        log.error(`${tag} | ${answerModel} Fehler, eskaliert:`, error);
        await escalate(channel, 'Interner Fehler bei der Antwortgenerierung.', client, roleIds);
        return;
    }
    const aMs = ((Date.now() - tAns) / 1000).toFixed(1);
    const { answer } = outcome;
    ticket.autoReplies += outcome.sent;

    if (outcome.exhausted) {
        log.info(`${tag} | Aktions-Limit erreicht, eskaliert`);
        await escalate(channel, 'Maximale Anzahl an Aktionsschritten erreicht, bitte übernehmen.', client, roleIds);
        return;
    }

    const upgrade = answer.consoleUpgrade && canUpgrade(store.getTicket(channel.id));

    if (answer.escalate || (!answer.response && !upgrade)) {
        log.info(`${tag}${imgPart} | ${gate.source} respond (${gMs}s) | ${answerModel} eskaliert (${aMs}s) | "${log.truncate(answer.reason, 140)}"`);
        await escalate(channel, answer.reason || 'Keine belastbare Antwort aus der Wissensdatenbank.', client, roleIds);
        return;
    }

    if (answer.response) {
        await sendAnswer(channel, answer.response);
        ticket.autoReplies += 1;
    }
    ticket.pendingImages = [];
    setStatus(channel.id, TicketStatus.ACTIVE_BOT);
    const count = unlimited ? `${ticket.autoReplies}` : `${ticket.autoReplies}/${max}`;
    log.info(`${tag}${imgPart} | ${gate.source} respond (${gMs}s) | ${answerModel} ok (${aMs}s) | gesendet ${count}`);
    if (ticketAssistant.verbose && answer.response) log.info(`${tag} | Antwort: "${log.truncate(answer.response, 200)}"`);

    if (upgrade) await autoUpgrade(channel, client, answer, Boolean(answer.response), roleIds);
}

async function autoUpgrade(channel, client, answer, answered, roleIds) {
    try {
        const result = await upgradeToConsole(channel, { by: 'Bot (automatisch)', reason: answer.reason });
        if (!result.ok) throw new Error(result.message);
        log.info(`#${channel.name} | automatisch auf Console hochgestuft`);
    } catch (error) {
        log.error(`#${channel.name} | Console-Upgrade fehlgeschlagen:`, error);
        if (!answered) await escalate(channel, 'Console-Upgrade fehlgeschlagen.', client, roleIds);
    }
}

async function sendAnswer(channel, text) {
    const safe = text.length > DISCORD_MESSAGE_LIMIT ? `${text.slice(0, DISCORD_MESSAGE_LIMIT - 1)}...` : text;
    await channel.send({ content: safe, allowedMentions: { parse: [] } });
}

module.exports = { handleTicketChannelCreate, handleTicketChannelDelete, handleTicketMessage };
