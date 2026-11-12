const { ticketSystem } = require('../../config');
const { createBrandedEmbed } = require('../../utils/embed');
const log = require('../ticketAssistant/log');

const STATUS = {
    executed: { label: 'Ausgeführt', color: 0x57f287 },
    dry_run: { label: 'Trockenlauf (nicht gesendet)', color: 0x3498db },
    denied_policy: { label: 'Abgelehnt (Policy)', color: 0xed4245 },
    denied_supervisor: { label: 'Abgelehnt (Supervisor)', color: 0xed4245 },
    rejected: { label: 'Abgelehnt (Team)', color: 0xed4245 },
    timeout: { label: 'Bestätigung abgelaufen', color: 0xfee75c },
    error: { label: 'Fehler bei der Ausführung', color: 0xe67e22 },
    logs: { label: 'Log-Abfrage', color: 0x95a5a6 },
    pending: { label: 'Wartet auf Bestätigung', color: 0xfee75c },
};

function field(name, value, inline = false) {
    const text = String(value ?? '').trim() || '-';
    return { name, value: text.length > 1000 ? `${text.slice(0, 1000)}...` : text, inline };
}

function code(text) {
    return `\`\`\`\n${String(text ?? '').replace(/`/g, "'").slice(0, 900)}\n\`\`\``;
}

// Baut das Audit-Embed, wird auch für die Bestätigungsanfrage verwendet.
function buildEmbed(client, data) {
    const status = STATUS[data.status] || { label: data.status, color: 0x95a5a6 };
    // Log-Abfragen lesen nur Dateien, sie laufen nicht über die Konsole.
    const isLogs = data.status === 'logs';
    const embed = createBrandedEmbed(client).setColor(status.color).setTitle(isLogs ? status.label : `Console: ${status.label}`);
    const fields = [
        field('Ticket', `<#${data.channelId}>`, true),
        field('Ausgelöst von', data.userId ? `<@${data.userId}>` : '-', true),
        field(isLogs ? 'Server-Log' : 'Ziel', data.target, true),
    ];
    if (data.command) fields.push(field(isLogs ? 'Suche' : 'Befehl', code(data.command)));
    if (data.rationale) fields.push(field('Begründung (Antwortmodell)', data.rationale));
    if (data.tier) fields.push(field('Tier / Profil', `${data.tier} / ${data.profile}`, true));
    if (data.policy) fields.push(field('Policy', data.policy));
    if (data.supervisor) fields.push(field('Supervisor', data.supervisor));
    if (data.output) fields.push(field('Ausgabe', code(data.output)));
    if (data.note) fields.push(field('Hinweis', data.note));
    return embed.addFields(fields);
}

async function post(client, data) {
    const kind = data.status === 'logs' ? 'logs' : `console ${data.status}`;
    const line = `#${data.channelName || data.channelId} | ${kind} | ${data.target} | ${log.truncate(data.command, 80)}`;
    log.info(line);
    try {
        const channel = await client.channels.fetch(ticketSystem.auditChannelId);
        if (channel?.isTextBased()) await channel.send({ embeds: [buildEmbed(client, data)] });
    } catch (error) {
        log.error('Audit-Nachricht konnte nicht gesendet werden:', error);
    }
}

module.exports = { post, buildEmbed };
