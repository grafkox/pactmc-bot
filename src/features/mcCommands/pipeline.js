const { mcCommands } = require('../../config');
const store = require('../ticketSystem/store');
const { evaluate, profileAction } = require('./policy');
const { review } = require('./supervisor');
const { requestConfirmation } = require('./confirm');
const { execute } = require('./rcon');
const { hit } = require('./ratelimit');
const audit = require('./audit');
const { verifiedName } = require('../verification');
const { maskSensitive } = require('../serverLogs/sanitize');
const log = require('../ticketAssistant/log');

// Läuft in dieser Reihenfolge: Killswitch, Rate-Limit, Policy, Supervisor, Bestätigung, Ausführung.
// Das Ergebnis geht zurück an das Antwortmodell, damit es reagieren kann.
async function runCommand({ channel, client, info, action, userId, excerpts, staffExcerpts = [] }) {
    const base = { type: 'command', target: action.target, command: action.command };

    if (!store.getCommandsEnabled()) return { ...base, status: 'killswitch' };

    const limit = mcCommands.rateLimitPerMinute;
    if (!hit(`cmd:user:${userId}`, limit) || !hit(`cmd:channel:${channel.id}`, limit)) {
        log.warn(`#${channel.name} | Rate-Limit für Befehle erreicht`);
        return { ...base, status: 'rate_limited' };
    }

    const profile = store.getPolicyProfile();
    const policy = evaluate({ target: action.target, command: action.command });
    const entry = {
        channelId: channel.id,
        channelName: channel.name,
        userId,
        target: policy.target,
        command: policy.command || String(action.command ?? '').slice(0, 300),
        tier: policy.tier,
        profile,
        rationale: action.rationale,
    };

    if (policy.verdict === 'deny') {
        await audit.post(client, { ...entry, status: 'denied_policy', policy: policy.reason });
        return { ...base, command: entry.command, status: 'denied_policy', reason: policy.reason };
    }

    const result = { ...base, command: policy.command, tier: policy.tier };
    entry.policy = `Erlaubt (${policy.tier})`;

    const verdict = await review({
        target: policy.target,
        command: policy.command,
        tier: policy.tier,
        profile,
        rationale: action.rationale,
        ticket: info,
        excerpts,
        staffExcerpts,
        requesterName: verifiedName(userId),
    });
    entry.supervisor = verdict.allow ? `allow: ${verdict.reason}` : `deny: ${verdict.reason}`;
    if (!verdict.allow) {
        await audit.post(client, { ...entry, status: 'denied_supervisor' });
        return { ...result, status: 'denied_supervisor', reason: verdict.reason };
    }

    if (profileAction(profile, policy.tier) === 'confirm') {
        const decision = await requestConfirmation(client, channel, entry);
        if (decision !== 'approved') {
            const status = decision === 'timeout' ? 'timeout' : 'rejected';
            await audit.post(client, { ...entry, status });
            return { ...result, status };
        }
    }

    // Während der Bestätigung kann der Killswitch gezogen oder das Ticket geschlossen worden sein.
    const ticket = store.getTicket(channel.id);
    if (!store.getCommandsEnabled()) {
        await audit.post(client, { ...entry, status: 'error', note: 'Nicht ausgeführt: Der Killswitch wurde inzwischen aktiviert.' });
        return { ...result, status: 'killswitch' };
    }
    if (!ticket || ticket.status === 'closed' || ticket.mode !== 'console') {
        await audit.post(client, { ...entry, status: 'error', note: 'Nicht ausgeführt: Das Ticket ist nicht mehr offen.' });
        return { ...result, status: 'not_available' };
    }

    if (mcCommands.dryRun) {
        await audit.post(client, { ...entry, status: 'dry_run' });
        return { ...result, status: 'dry_run' };
    }

    try {
        const output = await execute(policy.target, policy.command);
        await audit.post(client, { ...entry, status: 'executed', output: output || '(keine Ausgabe)' });
        // Das Team sieht die Rohausgabe im Audit, das Modell bekommt sie ohne IP-Adressen.
        return { ...result, status: 'executed', output: maskSensitive(output) };
    } catch (error) {
        log.error(`#${channel.name} | RCON-Fehler (${policy.target}):`, error);
        await audit.post(client, { ...entry, status: 'error', note: error.message });
        // Technische Details (Hosts, Ports) gehen nicht ans Modell und damit nicht an Spieler.
        return { ...result, status: 'error', reason: 'Der Server war nicht erreichbar oder hat den Befehl nicht angenommen.' };
    }
}

module.exports = { runCommand };
