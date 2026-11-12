const MAX_LINE = 300;

function maskIpv6(match) {
    return match.includes('::') || match.split(':').length === 8 ? '[IP]' : match;
}

// Maskiert IP-Adressen, Mail-Adressen, Bestätigungscodes und Tokens.
function maskSensitive(text) {
    return String(text)
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[IP]')
        .replace(/(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi, maskIpv6)
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[Mail]')
        // Bestätigungscodes aus /msg dürfen nie über die Logs auslesbar sein.
        .replace(/(ticket-code\D{0,5})\d{4,8}/gi, '$1[Code]')
        .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[Token]')
        .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[Token]');
}

// Entfernt Daten, die nie an ein Modell oder in ein Ticket gehören sollen.
function sanitizeLine(line) {
    const stripped = String(line)
        .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ');
    const cleaned = maskSensitive(stripped).trim();
    return cleaned.length > MAX_LINE ? `${cleaned.slice(0, MAX_LINE)}...` : cleaned;
}

module.exports = { sanitizeLine, maskSensitive };
