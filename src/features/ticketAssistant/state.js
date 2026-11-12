const TicketStatus = Object.freeze({
    NEW: 'NEW',
    ACTIVE_BOT: 'ACTIVE_BOT',
    PAUSED_HUMAN: 'PAUSED_HUMAN',
    ESCALATED: 'ESCALATED',
});

// State pro Ticket-Channel, nur im Speicher. Nach einem Neustart wird der
// Verlauf beim ersten Batch aus dem Channel rekonstruiert.
const tickets = new Map();

function ensureTicket(channelId) {
    let ticket = tickets.get(channelId);
    if (!ticket) {
        ticket = {
            status: TicketStatus.NEW,
            autoReplies: 0,
            debounceTimer: null,
            pendingImages: [],
            busy: false,
            rerun: false,
            lastUserId: null,
        };
        tickets.set(channelId, ticket);
    }
    return ticket;
}

function getTicket(channelId) {
    return tickets.get(channelId);
}

function setStatus(channelId, status) {
    const ticket = ensureTicket(channelId);
    ticket.status = status;
    return ticket;
}

function clearTicket(channelId) {
    const ticket = tickets.get(channelId);
    if (ticket?.debounceTimer) {
        clearTimeout(ticket.debounceTimer);
    }
    tickets.delete(channelId);
}

module.exports = { TicketStatus, ensureTicket, getTicket, setStatus, clearTicket };
