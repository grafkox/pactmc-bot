const { ticketAssistant } = require('../../config');

const ACTIONS = {
    bot_answers: 'respond',
    team_takes_over: 'escalate',
    no_action: 'silent',
};

const INTRO = 'Ein Spieler hat diese Nachricht in ein Support-Ticket auf einem deutschen Minecraft-Server (PactMC) geschrieben. Entscheide, wer den nächsten Schritt übernimmt: der KI-Support-Bot, ein menschliches Teammitglied oder vorerst niemand.';

const CRITERIA = {
    bot_answers: 'Der Spieler stellt eine Frage oder sucht Hilfe zu Minecraft, dem Server, Befehlen, Regeln, Features oder Technik (Joinen, Lag, Crashes), oder eröffnet allgemein mit einer Begrüßung oder Hilfebitte. Der KI-Bot kann antworten.',
    team_takes_over: 'Ein Mensch aus dem Team muss übernehmen: Bann, Mute, Strafe, Bewerbung, Beschwerde oder Meldung über Spieler oder Team, Zahlung, Spende oder Rückerstattung, Account- oder Login-Problem, Items oder Inventar zurückholen, Rang- oder Rollenänderung, Regelausnahme, der Spieler verlangt einen Admin oder Menschen, oder ist beleidigend oder wütend.',
    no_action: 'Aktuell ist nichts zu tun: der Spieler sagt, er schickt gleich mehr oder man soll warten, bedankt sich nur oder bestätigt mit ok, oder macht Smalltalk ohne Bezug zum Server.',
};

const MAX_STATE_CHARS = 1500;

function isEnabled() {
    return Boolean(ticketAssistant.router.baseUrl);
}

// Letzte relevante User-Nachrichten, ohne Bot- und Staff-Nachrichten.
function buildState(history) {
    const own = history.filter((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[Staff]'));
    const text = own.slice(-ticketAssistant.router.contextMessages).map((m) => m.content).join('\n');
    return text.length > MAX_STATE_CHARS ? text.slice(-MAX_STATE_CHARS) : text;
}

async function route(history) {
    const { baseUrl, model, timeoutMs } = ticketAssistant.router;
    const state = buildState(history);
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let data;
    try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                state,
                questions: {
                    decision: { type: 'choice', instructions: INTRO, criteria: CRITERIA },
                },
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        data = await response.json();
    } finally {
        clearTimeout(timer);
    }

    const decision = data?.answers?.decision;
    const action = ACTIONS[decision?.choice];
    if (!action) throw new Error(`Unbekanntes Label: ${JSON.stringify(decision?.choice)}`);

    return {
        action,
        probs: decision.probabilities || {},
        latencyMs: Date.now() - started,
        state,
    };
}

module.exports = { route, isEnabled, buildState, ACTIONS };
