const { ActivityType } = require('discord.js');

// Liest kommagetrennte IDs aus einer Env-Variable, sonst null (dann gilt der Default).
const csvIds = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null);

// Zahl aus der Env. Tippfehler ergeben sonst NaN und schalten Limits still ab.
function envNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
    console.warn(`[Config] Ungültiger Wert für ${name}: "${raw}", nutze ${fallback}.`);
    return fallback;
}

// Schalter aus der Env: true/1/yes/on und false/0/no/off, Groß- und Kleinschreibung egal.
// onInvalid gilt bei unlesbaren Werten, z.B. bleibt der Trockenlauf bei einem Tippfehler an.
function envFlag(name, fallback, onInvalid = fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'ja', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'nein', 'off'].includes(value)) return false;
    console.warn(`[Config] Ungültiger Wert für ${name}: "${raw}", nutze ${onInvalid}.`);
    return onInvalid;
}

module.exports = {
    prefix: '!',
    ownerRoleId: '940232290129301551',
    adminRoleId: '940232290129301548',
    modRoleId: '940232290129301547',
    probeModRoleId: '1062080912390627380',
    modLeitungRoleId: '1075153593004466196',

    welcomeChannelId: '940232290628419649',
    rulesChannelId: '940232290628419650',
    ticketPanelChannelId: '1076595592647684166',
    supportVoiceChannelId: '940588586921758770',
    supportMessageChannelId: '1096516245186166824',
    supportPingRoleIds: ['940232290129301547'],

    // AI Ticket Assistant, siehe src/features/ticketAssistant/
    ticketAssistant: {
        // Mit TICKET_ASSISTANT_ENABLED=false abschaltbar; ohne baseUrl/apiKey/Kategorie ohnehin inaktiv.
        enabled: envFlag('TICKET_ASSISTANT_ENABLED', true),
        // Ausführlichere Logs (eingehende Nachrichten + Antworttext).
        verbose: envFlag('TICKET_ASSISTANT_VERBOSE', false),

        // Defaults für die Produktion, per Env fürs lokale Testen überschreibbar.
        ticketCategoryIds: csvIds(process.env.TICKET_CATEGORY_IDS) || ['940232291932840022'],
        // Rollen, die bei einer Eskalation gepingt werden, und Rollen, deren Nachricht den Bot pausiert.
        supportRoleIds: csvIds(process.env.SUPPORT_ROLE_IDS) || ['940232290129301547', '1062080912390627380'], // Mod, Probe Mod
        // Owner und Admin pausieren immer, auch wenn SUPPORT_ROLE_IDS zum Testen gesetzt ist.
        pauseRoleIds: csvIds(process.env.SUPPORT_ROLE_IDS)
            ? [...new Set(['940232290129301551', '940232290129301548', ...csvIds(process.env.SUPPORT_ROLE_IDS)])]
            : ['940232290129301551', '940232290129301548', '940232290129301547', '1062080912390627380'], // Owner, Admin, Mod, Probe Mod

        openWebUi: {
            baseUrl: process.env.OPENWEBUI_BASE_URL || '', // z.B. https://example.com/api
            apiKey: process.env.OPENWEBUI_API_KEY || '',
            gateModel: process.env.GATE_MODEL || 'pact-gate',
            answerModel: process.env.ANSWER_MODEL || 'pact-answer',
            timeoutMs: envNumber('OPENWEBUI_TIMEOUT_MS', 30000),
        },

        // Gate: openwebui (altes Gate), ollama (lokales Decision-Modell) oder shadow (altes Gate
        // entscheidet, das lokale läuft nur mit und wird verglichen).
        router: {
            mode: process.env.GATE_MODE || 'openwebui',
            baseUrl: process.env.OLLAMA_BASE_URL || '', // z.B. http://host:11434
            model: process.env.ROUTER_MODEL || 'nimble:latest',
            timeoutMs: envNumber('ROUTER_TIMEOUT_MS', 5000),
            contextMessages: envNumber('ROUTER_CONTEXT_MESSAGES', 3),
            fallback: process.env.ROUTER_FALLBACK || 'escalate', // escalate oder openwebui
            logFile: process.env.ROUTER_LOG_FILE ?? './data/router-log.jsonl', // leer = aus
        },

        debounceSeconds: envNumber('DEBOUNCE_SECONDS', 4),
        maxAutoReplies: envNumber('MAX_AUTO_REPLIES', 5),
        maxImagesPerBatch: 4,
        maxImageBytes: 8 * 1024 * 1024,
    },

    // Eigenes Ticket-System, siehe src/features/ticketSystem/
    ticketSystem: {
        enabled: envFlag('TICKET_SYSTEM_ENABLED', true),
        dataFile: process.env.TICKET_DATA_FILE || './data/tickets.json',
        // Schutz gegen Ticket-Spam und gegen Massen-Pings über /add.
        maxOpenPerUser: envNumber('TICKET_MAX_OPEN_PER_USER', 3),
        maxAddedUsers: 10,
        maxCreatedPerHour: 5,

        auditChannelId: '940232291488268366',
        consoleNotifyChannelId: '940232291488268366', // gleich dem Audit-Channel

        consoleCategoryOpen: '1521632563175886952',
        consoleCategoryClosed: '1521632622156054548',

        // Ticket-Typen fürs Panel. Bewerbung läuft über ein eigenes Panel.
        types: {
            bug: { label: 'Bug', categoryOpen: '940232291932840022', categoryClosed: '940293556042629240', access: 'general' },
            hilfe: { label: 'Hilfe', categoryOpen: '940232291932840022', categoryClosed: '940293556042629240', access: 'general' },
            beschwerde: { label: 'Beschwerde', categoryOpen: '940232291932840022', categoryClosed: '940293556042629240', access: 'general' },
            bewerbung: { label: 'Bewerbung', categoryOpen: '1089929945771417780', categoryClosed: '1089930267109621871', access: 'bewerbung' },
        },

        // Buttons im Haupt-Panel (Bewerbung hat ein eigenes Panel).
        panelTypes: ['bug', 'hilfe', 'beschwerde'],

        // Zugriffsrollen pro Access-Gruppe, zusätzlich zum Ersteller.
        accessRoles: {
            general: ['940232290129301551', '940232290129301548', '940232290129301547', '1062080912390627380'], // Owner, Admin, Mod, Probe-Mod
            bewerbung: ['940232290129301551', '940232290129301548', '1075153593004466196'], // Owner, Admin, Mod-Leitung
        },

        // Rollen, die beim Console-Upgrade den Zugang behalten (Probe-Mod fliegt raus).
        consoleAccessRoles: ['940232290129301551', '940232290129301548', '940232290129301547'], // Owner, Admin, Mod

        mention: {
            contextMessages: envNumber('MENTION_CONTEXT_MESSAGES', 15),
            contextHours: envNumber('MENTION_CONTEXT_HOURS', 48),
            extraChannels: ['1059082119126720604', '940232291488268365'], // Mod-Chat, Admin-Chat
            staffRoles: ['940232290129301551', '940232290129301548', '1075153593004466196', '940232290129301547', '1062080912390627380'],
        },
    },

    // Minecraft-Befehle per RCON, siehe src/features/mcCommands/
    mcCommands: {
        targets: {
            velocity: {
                host: process.env.VELOCITY_RCON_HOST || '',
                port: envNumber('VELOCITY_RCON_PORT', 25575),
                password: process.env.VELOCITY_RCON_PASSWORD || '',
            },
            leaf: {
                host: process.env.LEAF_RCON_HOST || '',
                port: envNumber('LEAF_RCON_PORT', 25575),
                password: process.env.LEAF_RCON_PASSWORD || '',
            },
        },
        supervisorModel: process.env.SUPERVISOR_MODEL || 'pact-terminal-supervisor',
        // Maximale Aktionsschritte (Befehle und Log-Abfragen) pro Nutzer-Nachricht.
        maxCycles: envNumber('ACTION_MAX_CYCLES', 3),
        rateLimitPerMinute: envNumber('MC_RATE_LIMIT_PER_USER', 5),
        timeoutMs: envNumber('RCON_TIMEOUT_MS', 5000),
        confirmTimeoutMs: 10 * 60 * 1000,
        // Prüft und loggt alles, sendet aber nichts an den Server.
        dryRun: envFlag('MC_DRY_RUN', false, true),
        // Spielernamen, die ban/pardon/kick nie treffen dürfen (Team).
        protectedPlayers: csvIds(process.env.MC_PROTECTED_PLAYERS) || [],
    },

    // Lesender Zugriff auf Server-Logs, siehe src/features/serverLogs/
    serverLogs: {
        enabled: envFlag('SERVER_LOGS_ENABLED', true),
        paths: {
            velocity: process.env.VELOCITY_LOGS_PATH || '/data/logs/velocity/logs',
            leaf: process.env.LEAF_LOGS_PATH || '/data/logs/leaf/logs',
        },
        defaultHours: 24,
        maxHours: 168,
        maxLines: 30,
        maxFiles: 10,
        maxBytesPerFile: 64 * 1024 * 1024,
        rateLimitPerMinute: 10,
    },

    mcHost: 'pactmc.de',

    embedBranding: {
        color: '#206694',
        websiteUrl: 'https://pactmc.de',
        botPathUrl: 'https://pactmc.de/bot/',
        thumbnailUrl: 'https://pactmc.de/assets/pactmc-icon-i2-transparent.png',
        authorName: 'PactMC',
        footerText: 'Bot made by @grafkox_lp',
        footerIconUrl: 'https://cdn.discordapp.com/avatars/455285844350074881/e799202175df16a29598e9e8969dfb52.png?size=2048',
    },

    statusArray: [
        { name: 'mit (/) Commands', type: ActivityType.Playing, status: 'online' },
        { name: '/help | PactMC', type: ActivityType.Playing, status: 'online' },
    ],
};
