const { mcCommands } = require('../../config');

const TIERS = ['read-only', 'moderation', 'privileged', 'destructive'];
const MAX_LENGTH = 256;
const MAX_GIVE_COUNT = 64;

// Tiers:
//   read-only    reine Abfragen ohne private Spielerdaten
//   moderation   kick
//   privileged   alles, was Spielern etwas gibt, sie bewegt, sperrt oder in ihrem Namen spricht
//   destructive  clear, kill
// Was ein Profil pro Tier macht: auto (ohne Rückfrage) oder confirm (Owner/Admin bestätigt).
const PROFILES = {
    open: {
        description: 'Alles außer der Blocklist läuft automatisch. Supervisor und Audit laufen immer.',
        actions: { 'read-only': 'auto', moderation: 'auto', privileged: 'auto', destructive: 'auto' },
    },
    guarded: {
        description: 'Abfragen und kick laufen automatisch, alles andere (give, tp, ban, gamemode, clear ...) braucht eine Bestätigung von Owner oder Admin.',
        actions: { 'read-only': 'auto', moderation: 'auto', privileged: 'confirm', destructive: 'confirm' },
    },
    locked: {
        description: 'Jeder Befehl braucht eine Bestätigung von Owner oder Admin.',
        actions: { 'read-only': 'confirm', moderation: 'confirm', privileged: 'confirm', destructive: 'confirm' },
    },
};

// Diese Befehle werden immer abgelehnt, egal was ein Modell oder ein Profil sagt.
const BLOCKED = new Set([
    'stop', 'restart', 'shutdown', 'end', 'op', 'deop', 'reload', 'rl', 'reloadconfirm',
    'execute', 'function', 'schedule', 'datapack', 'return', 'perf', 'debug', 'jfr',
    'publish', 'forceload', 'setidletimeout', 'transfer', 'save-off', 'save-on', 'save-all',
    'ban-ip', 'pardon-ip', 'lp', 'luckperms', 'perms', 'perm', 'permissions', 'pex',
    'plugman', 'rcon', 'sudo', 'console',
]);

const BLOCKED_ITEMS = new Set([
    'command_block', 'repeating_command_block', 'chain_command_block', 'command_block_minecart',
    'structure_block', 'structure_void', 'jigsaw', 'test_block', 'test_instance_block',
    'barrier', 'light', 'debug_stick', 'bedrock', 'end_portal_frame', 'spawner', 'trial_spawner',
    'vault', 'reinforced_deepslate', 'knowledge_book', 'written_book', 'writable_book',
]);

// Schlüsselwörter, die bei Velocity (send all, send current) viele Spieler treffen.
const RESERVED_NAMES = new Set(['all', 'current']);
const PLAYER = /^\.?[A-Za-z0-9_]{1,16}$/;
const NUMBER = /^~?-?\d+(\.\d+)?$/;
const ID = /^[a-z0-9_]+$/;

const ok = (tier) => ({ tier });
const no = (reason) => ({ deny: reason });

function isProtected(name) {
    const lower = name.toLowerCase();
    return mcCommands.protectedPlayers.some((p) => p.toLowerCase() === lower);
}

// Gibt einen Ablehnungsgrund zurück oder null.
function playerProblem(name, { protect = false } = {}) {
    if (!PLAYER.test(name || '') || RESERVED_NAMES.has(name.toLowerCase())) {
        return 'Ungültiger Spielername (nur ein einzelner Name, keine Selektoren oder Schlüsselwörter).';
    }
    if (protect && isProtected(name)) return 'Dieser Spieler ist geschützt (Team).';
    return null;
}

function withPlayer(name, tier, opts) {
    const problem = playerProblem(name, opts);
    return problem ? no(problem) : ok(tier);
}

const readOnly = () => ok('read-only');
const readOnlyNoArgs = (args) => (args.length === 0 ? ok('read-only') : no('Dieser Befehl erlaubt hier keine Argumente.'));

const leaf = {
    list: (args) => (args.length === 0 || (args.length === 1 && args[0] === 'uuids') ? ok('read-only') : no('list: ungültige Argumente.')),
    tps: readOnlyNoArgs,
    mspt: readOnlyNoArgs,
    version: readOnlyNoArgs,
    ver: readOnlyNoArgs,
    plugins: readOnlyNoArgs,
    pl: readOnlyNoArgs,
    help: readOnly,
    banlist: (args) => (args.length === 0 || (args.length === 1 && args[0] === 'players') ? ok('read-only') : no('banlist: nur die Spielerliste ist erlaubt.')),
    time: (args) => (args[0] === 'query' ? ok('read-only') : no('time: nur "query" ist erlaubt.')),
    // Liest Position, Inventar oder Kisteninhalt aus, deshalb nie ohne Bestätigung.
    data: (args) => {
        if (args[0] !== 'get') return no('data: nur "get" ist erlaubt.');
        if (args[1] === 'entity' && args.length >= 3 && args.length <= 4) return withPlayer(args[2], 'privileged');
        if (args[1] === 'block' && args.length >= 5 && args.length <= 6 && args.slice(2, 5).every((n) => NUMBER.test(n))) return ok('privileged');
        return no('data: erlaubt sind "get entity <Spieler> [Pfad]" und "get block <x> <y> <z> [Pfad]".');
    },
    scoreboard: (args) => (args[0] === 'players' && ['get', 'list'].includes(args[1]) ? ok('read-only') : no('scoreboard: nur "players get/list" ist erlaubt.')),
    gamerule: (args) => (args.length === 1 ? ok('read-only') : no('gamerule: Setzen ist gesperrt, nur Abfragen sind erlaubt.')),
    whitelist: (args) => {
        if (args[0] === 'list' && args.length === 1) return ok('read-only');
        if (args[0] === 'add' && args.length === 2) return withPlayer(args[1], 'privileged');
        if (args[0] === 'remove' && args.length === 2) return withPlayer(args[1], 'privileged', { protect: true });
        return no('whitelist: nur list, add <Spieler> und remove <Spieler> sind erlaubt.');
    },
    experience: (args) => {
        if (args[0] === 'query' && args.length >= 2) return withPlayer(args[1], 'read-only');
        if (['add', 'set'].includes(args[0]) && args.length >= 3 && args.length <= 4) {
            if (!/^\d{1,4}$/.test(args[2])) return no('experience: Menge muss eine Zahl bis 9999 sein.');
            if (args[3] && !['points', 'levels'].includes(args[3])) return no('experience: points oder levels erwartet.');
            return withPlayer(args[1], 'privileged');
        }
        return no('experience: ungültige Argumente.');
    },
    say: (args) => (args.length >= 1 ? ok('privileged') : no('say: Text fehlt.')),
    msg: (args) => (args.length >= 2 ? withPlayer(args[0], 'privileged') : no('msg: Spieler und Text erwartet.')),
    kick: (args) => (args.length >= 1 ? withPlayer(args[0], 'moderation', { protect: true }) : no('kick: Spieler fehlt.')),
    ban: (args) => (args.length >= 1 ? withPlayer(args[0], 'privileged', { protect: true }) : no('ban: Spieler fehlt.')),
    pardon: (args) => (args.length === 1 ? withPlayer(args[0], 'privileged', { protect: true }) : no('pardon: genau ein Spieler erwartet.')),
    give: (args) => {
        if (args.length < 2 || args.length > 3) return no('give: erwartet <Spieler> <Item> [Anzahl].');
        const problem = playerProblem(args[0]);
        if (problem) return no(problem);
        const item = args[1].toLowerCase().replace(/^minecraft:/, '');
        if (!ID.test(item)) return no('give: nur einfache Item-IDs ohne Komponenten sind erlaubt.');
        if (BLOCKED_ITEMS.has(item)) return no(`give: Item ${item} ist gesperrt.`);
        if (args[2] !== undefined && (!/^\d{1,3}$/.test(args[2]) || Number(args[2]) < 1 || Number(args[2]) > MAX_GIVE_COUNT)) {
            return no(`give: Anzahl muss zwischen 1 und ${MAX_GIVE_COUNT} liegen.`);
        }
        return ok('privileged');
    },
    teleport: (args) => {
        if (args.length === 2) {
            const problem = playerProblem(args[0]) || playerProblem(args[1]);
            return problem ? no(problem) : ok('privileged');
        }
        if (args.length === 4 && args.slice(1).every((n) => NUMBER.test(n))) return withPlayer(args[0], 'privileged');
        return no('tp: erwartet <Spieler> <Spieler> oder <Spieler> <x> <y> <z>.');
    },
    gamemode: (args) => {
        if (args.length !== 2 || !['survival', 'creative', 'adventure', 'spectator'].includes(args[0])) return no('gamemode: erwartet <Modus> <Spieler>.');
        return withPlayer(args[1], 'privileged');
    },
    effect: (args) => {
        if (args[0] === 'clear' && args.length >= 2 && args.length <= 3) return withPlayer(args[1], 'privileged');
        if (args[0] === 'give' && args.length >= 3 && args.length <= 6) {
            if (!ID.test(args[2].replace(/^minecraft:/, ''))) return no('effect: ungültige Effekt-ID.');
            if (args[3] !== undefined && !(/^\d{1,3}$/.test(args[3]) && Number(args[3]) <= 600)) return no('effect: Dauer maximal 600 Sekunden.');
            if (args[4] !== undefined && !(/^\d$/.test(args[4]) && Number(args[4]) <= 3)) return no('effect: Stärke maximal 3.');
            return withPlayer(args[1], 'privileged');
        }
        return no('effect: ungültige Argumente.');
    },
    clear: (args) => (args.length >= 1 && args.length <= 3 ? withPlayer(args[0], 'destructive', { protect: true }) : no('clear: erwartet <Spieler> [Item] [Anzahl].')),
    kill: (args) => (args.length === 1 ? withPlayer(args[0], 'destructive', { protect: true }) : no('kill: genau ein Spielername erwartet, keine Selektoren.')),
};
leaf.tell = leaf.msg;
leaf.w = leaf.msg;
leaf.tp = leaf.teleport;
leaf.xp = leaf.experience;
leaf['?'] = leaf.help;

const velocity = {
    glist: (args) => (args.length <= 1 ? ok('read-only') : no('glist: ungültige Argumente.')),
    velocity: (args) => (['version', 'plugins', 'info'].includes(args[0]) && args.length === 1 ? ok('read-only') : no('velocity: nur version, plugins und info sind erlaubt.')),
    send: (args) => {
        if (args.length !== 2) return no('send: erwartet <Spieler> <Server>.');
        if (!/^[a-z0-9_-]{1,32}$/i.test(args[1])) return no('send: ungültiger Servername.');
        return withPlayer(args[0], 'privileged', { protect: true });
    },
};

const COMMANDS = { leaf, velocity };

function deny(base, reason) {
    return { ...base, verdict: 'deny', tier: null, reason };
}

// Prüft einen vorgeschlagenen Befehl. Das Ergebnis ist die einzige Quelle für das, was
// später ausgeführt wird (command ist normalisiert).
function evaluate({ target, command }) {
    const base = { target, command: '' };
    if (!Object.hasOwn(COMMANDS, target)) return deny(base, 'Unbekanntes Ziel, erlaubt sind leaf und velocity.');
    if (typeof command !== 'string' || !command.trim()) return deny(base, 'Kein Befehl angegeben.');
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(command) || command.includes('§')) return deny(base, 'Steuer- oder Sonderzeichen im Befehl.');

    const tokens = command.trim().replace(/^\//, '').split(/\s+/);
    const name = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    const normalized = [name, ...args].join(' ');
    const result = { target, command: normalized };

    if (normalized.length > MAX_LENGTH) return deny(result, `Befehl ist länger als ${MAX_LENGTH} Zeichen.`);
    if (name.includes(':')) return deny(result, 'Befehle mit Namespace sind nicht erlaubt.');
    if (BLOCKED.has(name)) return deny(result, `Der Befehl "${name}" ist hart gesperrt.`);

    const rule = Object.hasOwn(COMMANDS[target], name) ? COMMANDS[target][name] : null;
    if (!rule) return deny(result, `Der Befehl "${name}" steht nicht auf der Allowlist für ${target}.`);

    const resolved = rule(args);
    if (resolved.deny) return deny(result, resolved.deny);
    if (normalized.includes('@')) return deny(result, 'Selektoren (@) sind nicht erlaubt.');
    return { ...result, verdict: 'allow', tier: resolved.tier, reason: '' };
}

function profileAction(profile, tier) {
    const entry = PROFILES[profile] || PROFILES.locked;
    return entry.actions[tier] || 'confirm';
}

module.exports = { evaluate, profileAction, PROFILES, TIERS, BLOCKED };
