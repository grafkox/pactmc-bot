const { createBrandedEmbed } = require('../../utils/embed');
const { ticketAssistant } = require('../../config');
const { setStatus, TicketStatus } = require('./state');
const log = require('./log');

async function escalate(channel, reason, client, roleIds = ticketAssistant.supportRoleIds) {
    setStatus(channel.id, TicketStatus.ESCALATED);

    const rolePings = roleIds.map((id) => `<@&${id}>`).join(', ');
    const shortReason = log.truncate(reason, 800);
    const embed = createBrandedEmbed(client)
        .setTitle('Support benötigt')
        .setDescription(
            'Hier sollte ein Teammitglied übernehmen, ich konnte nicht abschließend weiterhelfen.' +
            (shortReason ? `\n\n*Grund:* ${shortReason}` : ''),
        )
        .setFooter({ text: 'Automatische Eskalation' });

    try {
        await channel.send({ content: rolePings, embeds: [embed], allowedMentions: { roles: roleIds } });
        log.info(`#${channel.name} | eskaliert: ${shortReason}`);
    } catch (error) {
        log.error(`#${channel.name} | Eskalation fehlgeschlagen:`, error);
    }
}

module.exports = { escalate };
