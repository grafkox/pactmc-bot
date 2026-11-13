const { serverLogs } = require('../../config');
const { hit } = require('../mcCommands/ratelimit');
const audit = require('../mcCommands/audit');
const { queryLogs } = require('./reader');
const { maskSensitive } = require('./sanitize');
const { verify, verifiedName, isValidName } = require('../verification');
const log = require('../ticketAssistant/log');

const SERVERS = ['leaf', 'velocity'];
const RESULT_LABELS = {
    ok: 'Treffer gefunden',
    no_matches: 'Keine Treffer',
    unavailable: 'Log-Verzeichnis nicht erreichbar',
    error: 'Fehler beim Lesen',
};

function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

// Zeilen, die eindeutig einem Spieler gehören (Chat, Befehle, Join, Leave, Login).
const PLAYER_LINE_PATTERNS = [
    /<(?:\[[^\]]*\]\s*)?(\.?\w{1,16})>/,
    /(\.?\w{1,16}) issued server command/,
    /(\.?\w{1,16}) (?:joined|left) the game/,
    /(\.?\w{1,16}) lost connection/,
    /(\.?\w{1,16})\[\/.*logged in/,
    /UUID of player (\.?\w{1,16}) is/,
    // Velocity und weitere Verbindungs- oder Fortschrittszeilen
    /\[connected player\] (\.?\w{1,16})/i,
    /\[server connection\] (\.?\w{1,16})/i,
    /(\.?\w{1,16}) has (?:connected|disconnected)/,
    /Disconnecting (\.?\w{1,16})/,
    /(\.?\w{1,16}) moved too quickly/,
    /(\.?\w{1,16}) has (?:made the advancement|completed the challenge|reached the goal)/,
];
// Todesnachricht eines Spielers: Name direkt nach dem Log-Präfix, danach eine typische Formulierung.
const DEATH_LINE = /\]: (\.?\w{3,16}) (?:was |died|drowned|blew up|hit the ground|fell |went up in flames|burned|walked into|tried to swim|experienced kinetic|froze|starved|suffocated|withered away|discovered the floor|left the confines|didn't want to live)/;
const COORD_TRIPLE = /-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g;
const COORD_AXIS = /\b([xyz])=-?\d+(?:\.\d+)?/gi;

// Was ein Spieler aus den Logs sehen darf: keine Chat-, Befehls- oder Verbindungszeilen anderer
// Spieler, und Koordinaten nur in Zeilen, in denen er selbst vorkommt.
function playerView(line, ownName) {
    const own = ownName.toLowerCase();
    for (const pattern of PLAYER_LINE_PATTERNS) {
        const match = pattern.exec(line);
        if (match && match[1].toLowerCase() !== own) return null;
    }
    // Ganzes Wort, sonst gälte "Pro" auch für Zeilen von "Pro100".
    const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionsOwn = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(line);
    // Tode anderer Spieler nur, wenn der Spieler selbst beteiligt war.
    const death = DEATH_LINE.exec(line);
    if (death && death[1].toLowerCase() !== own && !mentionsOwn) return null;
    // Zeilen mit IP-Adresse gehören zu Verbindungen und verraten sonst, wer wann online war.
    if (!mentionsOwn && maskSensitive(line).includes('[IP]')) return null;
    if (mentionsOwn) return line;
    return line.replace(COORD_TRIPLE, '[Koordinaten]').replace(COORD_AXIS, '$1=?');
}

function cleanTerm(value) {
    const text = String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
    return text.length >= 2 ? text.slice(0, 64) : '';
}

// Lesende Log-Abfrage im Namen des Spielers, der zuletzt geschrieben hat.
async function runLogs({ channel, client, action, userId }) {
    const server = SERVERS.includes(action.server) ? action.server : null;
    const base = { type: 'logs', server: action.server };
    if (!server) return { ...base, status: 'invalid', reason: 'Unbekannter Server, erlaubt sind leaf und velocity.' };
    if (!serverLogs.enabled) return { ...base, status: 'unavailable' };

    // Wer Logs abfragt, muss seinen Ingame-Namen bestätigt haben, und nach Spielernamen darf nur
    // mit dem eigenen gesucht werden. Die Bestätigung selbst läuft ohne KI (Code per /msg).
    const claimed = cleanTerm(action.ingameName) || cleanTerm(action.query?.player);
    let ownName = verifiedName(userId);
    let renamedFrom = null;
    if (!ownName) {
        if (!claimed || !isValidName(claimed)) return { ...base, status: 'verification_required' };
        const verification = await verify({ channel, client, userId, name: claimed });
        if (verification.status !== 'verified') return { ...base, status: verification.status };
        ownName = verification.name;
        // Hat der Spieler seinen Namen während der Bestätigung korrigiert, gilt der korrigierte.
        if (ownName.toLowerCase() !== claimed.toLowerCase()) renamedFrom = claimed;
    }

    let player = cleanTerm(action.query?.player);
    if (player && renamedFrom && player.toLowerCase() === renamedFrom.toLowerCase()) player = ownName;
    if (player && player.toLowerCase() !== ownName.toLowerCase()) {
        return { ...base, status: 'not_own_name', verifiedName: ownName };
    }

    const terms = [cleanTerm(action.query?.keyword), player].filter(Boolean);
    if (!terms.length) return { ...base, status: 'invalid', reason: 'Mindestens keyword oder player (je mindestens 2 Zeichen) ist nötig.' };

    if (!hit(`logs:user:${userId}`, serverLogs.rateLimitPerMinute)) return { ...base, status: 'rate_limited' };

    const sinceHours = clamp(action.query?.sinceHours, 1, serverLogs.maxHours, serverLogs.defaultHours);
    const maxLines = clamp(action.query?.maxLines, 1, serverLogs.maxLines, 20);

    let result;
    try {
        result = await queryLogs({ server, terms, sinceHours, maxLines, transform: (line) => playerView(line, ownName) });
    } catch (error) {
        log.error(`#${channel.name} | Log-Abfrage fehlgeschlagen:`, error);
        result = { status: 'error' };
    }

    await audit.post(client, {
        channelId: channel.id,
        channelName: channel.name,
        userId,
        target: server,
        command: `${terms.join(' + ')} (letzte ${sinceHours}h)`,
        status: 'logs',
        note: (RESULT_LABELS[result.status] || result.status) + (result.matches ? `, ${result.matches} Treffer` : ''),
    });

    return { ...base, ...result, terms, sinceHours, verifiedName: ownName };
}

module.exports = { runLogs, playerView };
