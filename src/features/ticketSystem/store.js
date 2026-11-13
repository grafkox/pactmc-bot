const fs = require('node:fs');
const path = require('node:path');
const { ticketSystem } = require('../../config');
const { PROFILES } = require('../mcCommands/policy');

const FILE = path.resolve(ticketSystem.dataFile);

function defaults() {
    return {
        counter: 0,
        tickets: {}, // channelId -> { type, opener, number, status, mode, added: [] }
        panels: {}, // key -> { channelId, messageId }
        commandsEnabled: false, // Console-Command-Zugang; startet aus (safe)
        policyProfile: 'guarded',
        links: {}, // discordId -> { name, verifiedAt }, bestätigte Ingame-Namen
    };
}

function load() {
    let raw;
    try {
        raw = fs.readFileSync(FILE, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return defaults(); // noch keine Datei
        // Z.B. fehlende Rechte: nicht mit leerem Stand weitermachen, sonst überschreibt das nächste Speichern alles.
        throw new Error(`Ticket-Daten nicht lesbar (${FILE}): ${error.message}`);
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('kein Objekt');
        const merged = { ...defaults(), ...parsed };
        for (const key of ['tickets', 'panels', 'links']) {
            if (!merged[key] || typeof merged[key] !== 'object') merged[key] = {};
        }
        return merged;
    } catch (error) {
        // Eine kaputte Datei nicht stillschweigend überschreiben, sonst sind Zähler und Tickets weg.
        const backup = `${FILE}.defekt-${Date.now()}`;
        try {
            fs.copyFileSync(FILE, backup);
        } catch {
            // Sicherung nicht möglich, weiter mit leerem Stand
        }
        console.error(`[TicketSys] ${FILE} ist nicht lesbar (${error.message}). Sicherung: ${backup}. Starte mit leerem Stand.`);
        return defaults();
    }
}

let state = load();

function save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
}

function nextNumber() {
    state.counter += 1;
    save();
    return state.counter;
}

function getTicket(channelId) {
    return state.tickets[channelId];
}

function allTickets() {
    return state.tickets;
}

function setTicket(channelId, data) {
    state.tickets[channelId] = { ...state.tickets[channelId], ...data };
    save();
    return state.tickets[channelId];
}

function deleteTicket(channelId) {
    if (state.tickets[channelId]) {
        delete state.tickets[channelId];
        save();
    }
}

function addUser(channelId, userId) {
    const ticket = state.tickets[channelId];
    if (!ticket) return;
    ticket.added = ticket.added || [];
    if (!ticket.added.includes(userId)) {
        ticket.added.push(userId);
        save();
    }
}

function removeUser(channelId, userId) {
    const ticket = state.tickets[channelId];
    if (!ticket?.added?.includes(userId)) return;
    ticket.added = ticket.added.filter((id) => id !== userId);
    save();
}

function getLink(discordId) {
    return state.links?.[discordId];
}

function setLink(discordId, name) {
    state.links = state.links || {};
    state.links[discordId] = { name, verifiedAt: Date.now() };
    save();
}

function removeLink(discordId) {
    if (!state.links?.[discordId]) return false;
    delete state.links[discordId];
    save();
    return true;
}

function allLinks() {
    return state.links || {};
}

function filePath() {
    return FILE;
}

function getPanel(key) {
    return state.panels[key];
}

function setPanel(key, data) {
    state.panels[key] = data;
    save();
}

function getCommandsEnabled() {
    return state.commandsEnabled;
}

function setCommandsEnabled(value) {
    state.commandsEnabled = Boolean(value);
    save();
}

function getPolicyProfile() {
    return state.policyProfile;
}

function setPolicyProfile(profile) {
    if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unbekanntes Policy-Profil: ${profile}`);
    state.policyProfile = profile;
    save();
}

module.exports = {
    nextNumber,
    getTicket,
    allTickets,
    setTicket,
    deleteTicket,
    addUser,
    removeUser,
    getLink,
    setLink,
    removeLink,
    allLinks,
    filePath,
    getPanel,
    setPanel,
    getCommandsEnabled,
    setCommandsEnabled,
    getPolicyProfile,
    setPolicyProfile,
};
