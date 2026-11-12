const { ticketAssistant } = require('../../config');
const log = require('./log');

function completionsUrl() {
    const base = ticketAssistant.openWebUi.baseUrl.replace(/\/+$/, '');
    return `${base}/chat/completions`;
}

async function chatCompletion(model, messages) {
    const { apiKey, timeoutMs } = ticketAssistant.openWebUi;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let data;
    try {
        const response = await fetch(completionsUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, messages, stream: false }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Open WebUI HTTP ${response.status}: ${body.slice(0, 300)}`);
        }
        data = await response.json();
    } finally {
        clearTimeout(timer);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new Error('Open WebUI lieferte keine Textantwort');
    }
    return content;
}

// Entfernt Code-Fences und greift notfalls das erste JSON-Objekt heraus.
function parseStrictJson(raw) {
    let text = raw.trim();

    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    if (!text.startsWith('{')) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end > start) {
            text = text.slice(start, end + 1);
        }
    }

    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Antwort ist kein JSON-Objekt');
    }
    return parsed;
}

const FORMAT_REMINDER = '[[FORMAT]] Deine letzte Antwort war kein gültiges JSON. Antworte jetzt ausschließlich mit dem '
    + 'geforderten JSON-Objekt, ohne Text davor oder danach. Den Inhalt deiner letzten Antwort übernimmst du dabei.';

// Holt eine Antwort und parst sie als JSON. Kommt Fließtext zurück (z.B. weil das RAG-Template von
// Open WebUI das Modell in Richtung normaler Antwort drückt), wird einmal mit Format-Hinweis nachgefragt.
async function completeJson(model, messages) {
    const raw = await chatCompletion(model, messages);
    try {
        return { raw, parsed: parseStrictJson(raw) };
    } catch {
        log.warn(`${model} lieferte kein JSON, frage einmal nach. Rohantwort: "${log.truncate(raw, 300)}"`);
        const retry = await chatCompletion(model, [
            ...messages,
            { role: 'assistant', content: raw.slice(0, 2000) },
            { role: 'user', content: FORMAT_REMINDER },
        ]);
        return { raw: retry, parsed: parseStrictJson(retry) };
    }
}

// Stufe A bekommt keine Bilder, nur einen Hinweis an der letzten User-Nachricht.
function withImageMarker(history, imageCount) {
    const messages = history.map((m) => ({ ...m }));
    if (imageCount > 0) {
        const marker = `\n\n[${imageCount} Bild(er) angehängt]`;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                messages[i].content = `${messages[i].content}${marker}`;
                return messages;
            }
        }
        messages.push({ role: 'user', content: marker.trim() });
    }
    return messages;
}

// Stufe B bekommt die Bilder als image_url-Parts an der letzten User-Nachricht.
function withImages(history, images) {
    const messages = history.map((m) => ({ ...m }));
    if (!images.length) return messages;

    const imageParts = images.map((img) => ({
        type: 'image_url',
        image_url: { url: img.dataUrl },
    }));

    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            const text = typeof messages[i].content === 'string' ? messages[i].content : '';
            messages[i].content = [{ type: 'text', text }, ...imageParts];
            return messages;
        }
    }
    messages.push({ role: 'user', content: imageParts });
    return messages;
}

async function runGate(history, { imageCount = 0 } = {}) {
    const messages = withImageMarker(history, imageCount);
    const { parsed } = await completeJson(ticketAssistant.openWebUi.gateModel, messages);
    return {
        should_respond: Boolean(parsed.should_respond),
        escalate: Boolean(parsed.escalate),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
}

function toText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Aktionen des Antwortmodells: ein Befehl oder eine Log-Abfrage.
function parseAction(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'command') {
        return {
            type: 'command',
            target: toText(raw.target, 20).toLowerCase(),
            command: typeof raw.command === 'string' ? raw.command.slice(0, 400) : '',
            rationale: toText(raw.rationale, 500),
        };
    }
    if (raw.type === 'verify') {
        return { type: 'verify', ingameName: toText(raw.ingame_name, 40) };
    }
    if (raw.type === 'logs') {
        const query = raw.query && typeof raw.query === 'object' ? raw.query : {};
        return {
            type: 'logs',
            server: toText(raw.server, 20).toLowerCase(),
            ingameName: toText(raw.ingame_name, 40),
            query: {
                keyword: toText(query.keyword, 100),
                player: toText(query.player, 100),
                sinceHours: query.sinceHours,
                maxLines: query.maxLines,
            },
        };
    }
    return { type: 'unknown' };
}

// Hängt Hinweise (z.B. Console-Status) an die letzte User-Nachricht.
function withNotes(history, notes) {
    const messages = history.map((m) => ({ ...m }));
    if (!notes.length) return messages;
    const text = notes.join('\n');
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
            messages[i].content = `${messages[i].content}\n\n${text}`;
            return messages;
        }
    }
    messages.push({ role: 'user', content: text });
    return messages;
}

async function runAnswer(history, images = [], { notes = [] } = {}) {
    const messages = withImages(withNotes(history, notes), images);
    const { raw, parsed } = await completeJson(ticketAssistant.openWebUi.answerModel, messages);
    const response = typeof parsed.response === 'string' && parsed.response.trim() ? parsed.response.trim() : null;
    return {
        response,
        escalate: Boolean(parsed.escalate),
        consoleUpgrade: parsed.console_upgrade === true,
        action: parseAction(parsed.action),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        raw: raw.trim(),
    };
}

// Antwort auf eine direkte @-Erwähnung. Gleiches Modell wie runAnswer, aber mit
// Modus-Hinweis: direkt antworten, bei Unsicherheit ehrlich sein, nicht von sich aus eskalieren.
async function runMention(history, images = []) {
    const marker = {
        role: 'system',
        content:
            'Modus: direkte @-Erwähnung im Chat. Antworte direkt, konkret und hilfreich auf die letzte Nachricht. '
            + 'Wenn du etwas nicht sicher aus der Wissensdatenbank weißt, sag das ehrlich und erfinde nichts. '
            + 'Eskaliere NICHT von dir aus; ein Mensch wird nur auf ausdrücklichen Wunsch des Users geholt.',
    };
    const messages = withImages([marker, ...history], images);
    const { parsed } = await completeJson(ticketAssistant.openWebUi.answerModel, messages);
    const response = typeof parsed.response === 'string' && parsed.response.trim() ? parsed.response.trim() : null;
    return {
        response,
        escalate: Boolean(parsed.escalate),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
}

module.exports = { chatCompletion, parseStrictJson, runGate, runAnswer, runMention };
