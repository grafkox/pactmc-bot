const { mcCommands } = require('../../config');
const { chatCompletion, parseStrictJson } = require('../ticketAssistant/openwebui');
const log = require('../ticketAssistant/log');

function clip(value, max) {
    return String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Zweite Schicht nach der Policy. Das Modell bekommt nur strukturierte Daten, der Nutzertext
// steht als Zitat in einem JSON-Feld. Alles außer einem eindeutigen "allow" gilt als Ablehnung.
async function review({ target, command, tier, profile, rationale, ticket, excerpts, staffExcerpts = [], requesterName = null }) {
    const payload = {
        target,
        command,
        tier,
        profile,
        ticket: { type: ticket.type, mode: ticket.mode },
        responder_rationale: clip(rationale, 500),
        user_messages_quoted: excerpts.slice(-2).map((text) => clip(text, 300)),
        // Per Ingame-Code bestätigter Name des Spielers, null wenn unbestätigt.
        requester_verified_name: requesterName,
        // Vom Bot anhand der Discord-Rolle verifiziert, nicht vom Spieler fälschbar.
        staff_messages_quoted: staffExcerpts.slice(-2).map((text) => clip(text, 300)),
    };

    let parsed;
    try {
        const raw = await chatCompletion(mcCommands.supervisorModel, [{ role: 'user', content: JSON.stringify(payload) }]);
        try {
            parsed = parseStrictJson(raw);
        } catch (error) {
            log.warn(`Supervisor lieferte kein JSON. Rohantwort: "${log.truncate(raw, 300)}"`);
            throw error;
        }
    } catch (error) {
        log.error('Supervisor nicht verfügbar oder ungültige Antwort:', error);
        // detail nur für /systemtest, das Antwortmodell bekommt den allgemeinen Grund.
        return { allow: false, error: true, detail: error.message, reason: 'Supervisor nicht verfügbar oder ungültige Antwort.' };
    }

    const reason = clip(parsed.reason, 400);
    if (parsed.verdict === 'allow') return { allow: true, reason };
    return { allow: false, reason: reason || 'Vom Supervisor abgelehnt.' };
}

module.exports = { review };
