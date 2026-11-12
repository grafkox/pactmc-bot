const { Rcon } = require('rcon-client');
const { mcCommands } = require('../../config');

const MAX_OUTPUT = 1500;

async function connect(cfg) {
    const connecting = Rcon.connect({
        host: cfg.host,
        port: cfg.port,
        password: cfg.password,
        timeout: mcCommands.timeoutMs,
    });
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('RCON-Verbindung hat das Zeitlimit überschritten.')), mcCommands.timeoutMs);
    });
    try {
        return await Promise.race([connecting, timeout]);
    } catch (error) {
        // Kommt die Verbindung doch noch zustande, sauber wieder schließen.
        connecting.then((rcon) => rcon.end().catch(() => {}), () => {});
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function cleanOutput(text) {
    const cleaned = String(text ?? '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .trim();
    return cleaned.length > MAX_OUTPUT ? `${cleaned.slice(0, MAX_OUTPUT)}...` : cleaned;
}

async function execute(target, command) {
    const cfg = mcCommands.targets[target];
    if (!cfg?.host || !cfg.password) throw new Error(`RCON für ${target} ist nicht konfiguriert.`);

    const rcon = await connect(cfg);
    rcon.on('error', () => {});
    try {
        return cleanOutput(await rcon.send(command));
    } finally {
        await rcon.end().catch(() => {});
    }
}

module.exports = { execute, cleanOutput };
