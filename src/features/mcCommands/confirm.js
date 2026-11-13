const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { ownerRoleId, adminRoleId, mcCommands, ticketSystem } = require('../../config');
const { hasAnyRole } = require('../../utils/hasAnyRole');
const { buildEmbed } = require('./audit');

const pending = new Map();

function buttons(id, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mc_confirm:${id}:yes`).setLabel('Ausführen').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`mc_confirm:${id}:no`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
}

// Bestätigungsanfrage geht in den Audit-Channel, nur Owner und Admin dürfen entscheiden.
// Gibt approved, denied oder timeout zurück.
async function requestConfirmation(client, ticketChannel, data) {
    const auditChannel = await client.channels.fetch(ticketSystem.auditChannelId).catch(() => null);
    if (!auditChannel?.isTextBased()) return 'denied';

    const id = randomUUID().slice(0, 8);
    const embed = buildEmbed(client, { ...data, status: 'pending', note: 'Owner oder Admin muss diesen Befehl bestätigen.' });
    const message = await auditChannel.send({
        content: `<@&${ownerRoleId}> <@&${adminRoleId}>`,
        embeds: [embed],
        components: [buttons(id)],
        allowedMentions: { roles: [ownerRoleId, adminRoleId] },
    });
    await ticketChannel.send({ content: 'Dieser Befehl wartet auf die Bestätigung eines Teammitglieds.', allowedMentions: { parse: [] } }).catch(() => {});

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            message.edit({ components: [buttons(id, true)] }).catch(() => {});
            resolve('timeout');
        }, mcCommands.confirmTimeoutMs);
        pending.set(id, { resolve, timer });
    });
}

async function handleConfirmButton(interaction) {
    const [, id, answer] = interaction.customId.split(':');

    if (!hasAnyRole(interaction.member, [ownerRoleId, adminRoleId])) {
        await interaction.reply({ content: 'Nur Owner und Admin dürfen Befehle bestätigen.', flags: MessageFlags.Ephemeral });
        return;
    }

    const entry = pending.get(id);
    if (!entry) {
        await interaction.update({ components: [buttons(id, true)] }).catch(() => {});
        await interaction.followUp({ content: 'Diese Anfrage ist abgelaufen oder wurde nach einem Neustart verworfen.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }

    pending.delete(id);
    clearTimeout(entry.timer);
    const approved = answer === 'yes';
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(approved ? 0x57f287 : 0xed4245)
        .addFields({ name: 'Entscheidung', value: `${approved ? 'Bestätigt' : 'Abgelehnt'} von <@${interaction.user.id}>` });
    // Erst entscheiden, dann anzeigen. Scheitert das Update, darf die Pipeline nicht ewig warten.
    entry.resolve(approved ? 'approved' : 'denied');
    await interaction.update({ content: '', embeds: [embed], components: [] }).catch((error) => {
        console.error('[MC] Bestätigung angezeigt nicht aktualisiert:', error.message);
    });
}

module.exports = { requestConfirmation, handleConfirmButton };
