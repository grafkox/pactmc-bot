const fs = require('node:fs');
const path = require('node:path');
const { ticketAssistant } = require('../../config');
const { runGate } = require('./openwebui');
const router = require('./router');
const log = require('./log');

const cfg = ticketAssistant.router;
const legacyLabel = ticketAssistant.openWebUi.gateModel;

if (cfg.mode !== 'openwebui' && !router.isEnabled()) {
    log.warn(`GATE_MODE=${cfg.mode}, aber OLLAMA_BASE_URL fehlt. Es läuft das OpenWebUI-Gate.`);
}

function activeMode() {
    if (!router.isEnabled()) return 'openwebui';
    return cfg.mode === 'ollama' || cfg.mode === 'shadow' ? cfg.mode : 'openwebui';
}

function fromAction(action) {
    if (action === 'respond') return { should_respond: true, escalate: false, reason: '' };
    if (action === 'escalate') return { should_respond: false, escalate: true, reason: 'Das Thema braucht ein Teammitglied.' };
    return { should_respond: false, escalate: false, reason: '' };
}

function toAction(gate) {
    if (gate.escalate) return 'escalate';
    return gate.should_respond ? 'respond' : 'silent';
}

const MAX_LOG_BYTES = 20 * 1024 * 1024;
let logDirReady = false;
let logLines = 0;

// Die Datei enthält Ticket-Texte. Wird sie zu groß, bleibt genau eine ältere Kopie (.1) liegen.
function rotateIfNeeded(file) {
    logLines += 1;
    if (logLines % 200 !== 1) return;
    try {
        if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
        // Datei existiert noch nicht
    }
}

function record(entry) {
    if (!cfg.logFile) return;
    try {
        const file = path.resolve(cfg.logFile);
        if (!logDirReady) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            logDirReady = true;
        }
        rotateIfNeeded(file);
        const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
        fs.appendFile(file, line, () => {});
    } catch (error) {
        log.warn(`Router-Log nicht schreibbar: ${error.message}`);
    }
}

async function legacy(history, imageCount) {
    const gate = await runGate(history, { imageCount });
    return { ...gate, source: legacyLabel };
}

// Bilder gehen direkt zum Antwortmodell, das spart den Request.
async function routerDecision(history, imageCount) {
    if (imageCount > 0) return { action: 'respond', probs: {}, latencyMs: 0, state: '[Bild]' };
    return router.route(history);
}

async function decideGate(history, { imageCount = 0, tag = '' } = {}) {
    const mode = activeMode();
    if (mode === 'openwebui') return legacy(history, imageCount);

    if (mode === 'shadow') {
        const shadow = routerDecision(history, imageCount).then((result) => ({ result }), (error) => ({ error }));
        const old = await legacy(history, imageCount);
        shadow.then((outcome) => reportShadow(tag, old, outcome));
        return old;
    }

    try {
        const result = await routerDecision(history, imageCount);
        record({ mode, channel: tag, text: result.state, action: result.action, probs: result.probs, latencyMs: result.latencyMs });
        return { ...fromAction(result.action), source: cfg.model };
    } catch (error) {
        log.error(`${tag} | ${cfg.model} Fehler:`, error);
        record({ mode, channel: tag, error: error.message });
        if (cfg.fallback === 'openwebui') return legacy(history, imageCount);
        throw error;
    }
}

function reportShadow(tag, old, outcome) {
    const oldAction = toAction(old);
    if (outcome.error) {
        log.warn(`${tag} | shadow ${cfg.model} Fehler: ${outcome.error.message}`);
        record({ mode: 'shadow', channel: tag, old: oldAction, error: outcome.error.message });
        return;
    }
    const { result } = outcome;
    const match = result.action === oldAction;
    record({ mode: 'shadow', channel: tag, text: result.state, old: oldAction, new: result.action, match, probs: result.probs, latencyMs: result.latencyMs });
    if (!match) {
        log.info(`${tag} | shadow Abweichung: ${legacyLabel}=${oldAction}, ${cfg.model}=${result.action} (${result.latencyMs}ms) "${log.truncate(result.state, 100)}"`);
    }
}

function gateLabel() {
    return activeMode() === 'ollama' ? cfg.model : legacyLabel;
}

module.exports = { decideGate, gateLabel };
