const {
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    RESTJSONErrorCodes,
} = require('discord.js');
const { ticketSystem } = require('../../config');
const { createBrandedEmbed } = require('../../utils/embed');
const { hasAnyRole } = require('../../utils/hasAnyRole');
const { hit } = require('../mcCommands/ratelimit');
const store = require('./store');
const {
    TicketStatus: AssistantStatus,
    ensureTicket: ensureAssistantTicket,
    setStatus: setAssistantStatus,
    clearTicket: clearAssistantTicket,
} = require('../ticketAssistant/state');
const verification = require('../verification');

const LOG = '[TicketSys]';

function pad(n) {
    return String(n).padStart(4, '0');
}

function accessRoleIds(typeKey) {
    const type = ticketSystem.types[typeKey];
    return ticketSystem.accessRoles[type.access] || [];
}

// Rollen, die das Ticket über die Kategorie-Rechte sehen.
function teamRoles(ticket) {
    return ticket.mode === 'console' ? ticketSystem.consoleAccessRoles : accessRoleIds(ticket.type);
}

// /add und /remove: das Team, in normalen Tickets zusätzlich der Ersteller. In Bewerbungen und
// Console-Tickets entscheidet nur das Team, wer mitliest.
function canManageUsers(interaction, ticket) {
    if (hasAnyRole(interaction.member, teamRoles(ticket))) return true;
    return ticket.type !== 'bewerbung' && ticket.mode !== 'console' && interaction.user.id === ticket.opener;
}

function buildOverwrites(guild, openerId, roleIds) {
    const memberPerms = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
    ];
    const overwrites = [
        { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        // Der Bot braucht selbst Zugriff, falls er keine Administrator-Rechte hat.
        { id: guild.client.user.id, type: OverwriteType.Member, allow: memberPerms },
        { id: openerId, type: OverwriteType.Member, allow: memberPerms },
    ];
    for (const roleId of roleIds) {
        overwrites.push({
            id: roleId,
            type: OverwriteType.Role,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
            ],
        });
    }
    return overwrites;
}

function closeButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger),
    );
}

// Offene Tickets eines Users. Einträge, deren Channel nicht mehr existiert, werden dabei entfernt.
function openTicketsOf(guild, userId) {
    const open = [];
    for (const [channelId, ticket] of Object.entries(store.allTickets())) {
        if (ticket.opener !== userId || ticket.status !== 'open') continue;
        if (!guild.channels.cache.has(channelId)) {
            store.deleteTicket(channelId);
            continue;
        }
        open.push(channelId);
    }
    return open;
}

// User, für die gerade ein Ticket angelegt wird (Schutz gegen Doppelklicks).
const creating = new Set();

async function openTicket(interaction, typeKey) {
    const reject = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!Object.hasOwn(ticketSystem.types, typeKey)) return reject('Unbekannter Ticket-Typ.');
    if (!ticketSystem.enabled) return reject('Das Ticket-System ist gerade deaktiviert.');

    const type = ticketSystem.types[typeKey];
    const userId = interaction.user.id;
    if (creating.has(userId)) return reject('Dein Ticket wird gerade erstellt.');

    const open = openTicketsOf(interaction.guild, userId);
    if (open.length >= ticketSystem.maxOpenPerUser) {
        return reject(`Du hast bereits ${open.length} offene Tickets (${open.map((id) => `<#${id}>`).join(', ')}). Schließ bitte zuerst eins davon.`);
    }
    // Schließen und neu öffnen würde sonst die Kategorien füllen (Discord: 50 Channels pro Kategorie).
    if (!hit(`ticket:create:${userId}`, ticketSystem.maxCreatedPerHour, 60 * 60 * 1000)) {
        return reject('Du hast in der letzten Stunde schon mehrere Tickets geöffnet. Versuch es später nochmal oder schreib in dein offenes Ticket.');
    }

    creating.add(userId);
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const number = store.nextNumber();
        const name = `${typeKey}-${pad(number)}`;
        const channel = await interaction.guild.channels.create({
            name,
            type: ChannelType.GuildText,
            parent: type.categoryOpen,
            permissionOverwrites: buildOverwrites(interaction.guild, userId, accessRoleIds(typeKey)),
        });

        store.setTicket(channel.id, {
            type: typeKey,
            opener: userId,
            number,
            status: 'open',
            mode: 'normal',
            added: [],
        });

        const embed = createBrandedEmbed(interaction.client)
            .setTitle(`${type.label}-Ticket #${pad(number)}`)
            .setDescription('Willkommen! Beschreib dein Anliegen so genau wie möglich, ein Teammitglied meldet sich. Zum Schließen den Button unten nutzen.');
        await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [closeButtonRow()] });

        await interaction.editReply({ content: `Dein Ticket wurde erstellt: ${channel}` });
        console.log(`${LOG} ${name} von ${interaction.user.username} geöffnet`);
    } catch (error) {
        console.error(`${LOG} Ticket konnte nicht erstellt werden:`, error);
        await interaction.editReply({ content: 'Das Ticket konnte nicht erstellt werden. Bitte melde dich direkt beim Team.' }).catch(() => {});
    } finally {
        creating.delete(userId);
    }
    return undefined;
}

const OPENER_PERMS = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true };
const ADDED_PERMS = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };

function confirmRow(prefix, label) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_confirm`).setLabel(label).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${prefix}_cancel`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );
}

function closedControlsRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Wieder öffnen').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_delete').setLabel('Löschen').setStyle(ButtonStyle.Danger),
    );
}

function openCategory(ticket) {
    return ticket.mode === 'console' ? ticketSystem.consoleCategoryOpen : ticketSystem.types[ticket.type].categoryOpen;
}

function closedCategory(ticket) {
    return ticket.mode === 'console' ? ticketSystem.consoleCategoryClosed : ticketSystem.types[ticket.type].categoryClosed;
}

// Prüft, ob der Channel ein Ticket im erwarteten Zustand ist, und antwortet sonst ephemeral.
// Geschlossene Tickets sieht nur das Team. Falls beim Schließen ein Rechte-Entzug fehlgeschlagen ist,
// soll der Ersteller trotzdem nicht wieder öffnen oder löschen können.
async function requireTeam(interaction, ticket) {
    if (hasAnyRole(interaction.member, teamRoles(ticket))) return true;
    await interaction.reply({ content: 'Geschlossene Tickets kann nur das Team wieder öffnen oder löschen.', flags: MessageFlags.Ephemeral });
    return false;
}

async function requireTicket(interaction, status) {
    const ticket = store.getTicket(interaction.channel.id);
    let problem = null;
    if (!ticket) problem = 'Das ist kein Ticket-Channel.';
    else if (status === 'open' && ticket.status === 'closed') problem = 'Das Ticket ist bereits geschlossen.';
    else if (status === 'closed' && ticket.status !== 'closed') problem = 'Das Ticket ist nicht geschlossen.';
    if (problem) {
        await interaction.reply({ content: problem, flags: MessageFlags.Ephemeral });
        return null;
    }
    return ticket;
}

// Die Rückfrage verschwindet wieder, egal ob bestätigt oder abgebrochen.
async function dismissPrompt(interaction) {
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
}

async function askClose(interaction) {
    if (!(await requireTicket(interaction, 'open'))) return;
    await interaction.reply({ content: 'Willst du das Ticket wirklich schließen?', components: [confirmRow('ticket_close', 'Schließen')] });
}

async function closeTicket(interaction) {
    const channel = interaction.channel;
    const ticket = store.getTicket(channel.id);
    await dismissPrompt(interaction);
    if (!ticket || ticket.status === 'closed') return;
    store.setTicket(channel.id, { status: 'closed' });
    verification.cancel(channel.id, interaction.client);

    // Eine Kategorie fasst höchstens 50 Channels. Ist das Archiv voll, bleibt das Ticket, wo es ist.
    await channel.setParent(closedCategory(ticket), { lockPermissions: false }).catch((error) => {
        console.warn(`${LOG} ${channel.name} konnte nicht ins Archiv verschoben werden: ${error.message}`);
    });
    // Ein Member-Overwrite schlägt die Rollenrechte. Teammitglieder (z.B. wenn ein Mod selbst ein
    // Ticket öffnet) verlieren deshalb nur ihren Overwrite und sehen das Archiv über die Rolle.
    for (const userId of [ticket.opener, ...(ticket.added || [])]) {
        const member = await channel.guild.members.fetch(userId).catch(() => null);
        if (hasAnyRole(member, teamRoles(ticket))) {
            await channel.permissionOverwrites.delete(userId).catch(() => {});
        } else {
            await channel.permissionOverwrites.edit(userId, { ViewChannel: false }).catch((error) => {
                console.error(`${LOG} ${channel.name}: Sicht für ${userId} nicht entzogen: ${error.message}`);
            });
        }
    }
    clearAssistantTicket(channel.id);

    const embed = createBrandedEmbed(interaction.client)
        .setTitle('Ticket geschlossen')
        .setDescription(`Geschlossen von <@${interaction.user.id}>.`);
    await channel.send({ embeds: [embed], components: [closedControlsRow()] });
    console.log(`${LOG} ${channel.name} geschlossen von ${interaction.user.username}`);
}

async function reopenTicket(interaction) {
    const channel = interaction.channel;
    const closedTicket = await requireTicket(interaction, 'closed');
    if (!closedTicket || !(await requireTeam(interaction, closedTicket))) return;
    await dismissPrompt(interaction);
    const ticket = store.getTicket(channel.id);
    if (!ticket || ticket.status !== 'closed') return;
    store.setTicket(channel.id, { status: 'open' });

    await channel.setParent(openCategory(ticket), { lockPermissions: false }).catch((error) => {
        console.warn(`${LOG} ${channel.name} konnte nicht zurück verschoben werden: ${error.message}`);
    });
    await channel.permissionOverwrites.edit(ticket.opener, OPENER_PERMS).catch(() => {});
    for (const userId of ticket.added || []) {
        await channel.permissionOverwrites.edit(userId, ADDED_PERMS).catch(() => {});
    }

    const embed = createBrandedEmbed(interaction.client)
        .setTitle('Ticket wieder geöffnet')
        .setDescription(`Wieder geöffnet von <@${interaction.user.id}>.`);
    await channel.send({ content: `<@${ticket.opener}>`, embeds: [embed] });
    console.log(`${LOG} ${channel.name} wieder geöffnet von ${interaction.user.username}`);
}

async function askDelete(interaction) {
    const ticket = await requireTicket(interaction, 'closed');
    if (!ticket || !(await requireTeam(interaction, ticket))) return;
    await interaction.reply({
        content: 'Willst du das Ticket endgültig löschen? Das kann nicht rückgängig gemacht werden.',
        components: [confirmRow('ticket_delete', 'Löschen')],
    });
}

async function deleteTicket(interaction) {
    const channel = interaction.channel;
    const ticket = store.getTicket(channel.id);
    if (!ticket || ticket.status !== 'closed') {
        await dismissPrompt(interaction);
        return;
    }
    if (!(await requireTeam(interaction, ticket))) return;
    await interaction.deferUpdate();
    console.log(`${LOG} ${channel.name} gelöscht von ${interaction.user.username}`);
    // Der Store-Eintrag fliegt über das channelDelete-Event raus.
    await channel.delete(`Ticket gelöscht von ${interaction.user.username}`);
}

async function addUserToTicket(interaction, user) {
    const ticket = store.getTicket(interaction.channel.id);
    if (!ticket) {
        await interaction.reply({ content: 'Das geht nur in einem Ticket-Channel.', flags: MessageFlags.Ephemeral });
        return;
    }
    const reject = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!canManageUsers(interaction, ticket)) {
        return reject(ticket.type === 'bewerbung' || ticket.mode === 'console'
            ? 'In diesem Ticket kann nur das Team User hinzufügen.'
            : 'User hinzufügen können nur der Ersteller des Tickets und das Team.');
    }
    if (ticket.status === 'closed') return reject('Das Ticket ist geschlossen.');
    if (user.bot) return reject('Bots können nicht zu Tickets hinzugefügt werden.');
    const added = ticket.added || [];
    if (user.id === ticket.opener || added.includes(user.id)) return reject(`${user} hat bereits Zugriff auf dieses Ticket.`);
    if (added.length >= ticketSystem.maxAddedUsers) {
        return reject(`Mehr als ${ticketSystem.maxAddedUsers} zusätzliche User sind pro Ticket nicht möglich.`);
    }
    // Teammitglieder sehen das Ticket über ihre Rolle. Ein eigener Overwrite würde sie beim Schließen aussperren.
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return reject(`${user} ist nicht auf diesem Server.`);
    if (hasAnyRole(member, teamRoles(ticket))) return reject(`${user} hat über seine Rolle bereits Zugriff auf dieses Ticket.`);

    await interaction.channel.permissionOverwrites.edit(user.id, ADDED_PERMS);
    store.addUser(interaction.channel.id, user.id);
    console.log(`${LOG} ${user.username || user.id} zu ${interaction.channel.name} hinzugefügt von ${interaction.user.username}`);
    await interaction.reply({ content: `${user} wurde zum Ticket hinzugefügt.`, allowedMentions: { users: [user.id] } });
    return undefined;
}

async function removeUserFromTicket(interaction, user) {
    const ticket = store.getTicket(interaction.channel.id);
    if (!ticket) {
        await interaction.reply({ content: 'Das geht nur in einem Ticket-Channel.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!canManageUsers(interaction, ticket)) {
        const content = ticket.type === 'bewerbung' || ticket.mode === 'console'
            ? 'In diesem Ticket kann nur das Team User entfernen.'
            : 'User entfernen können nur der Ersteller des Tickets und das Team.';
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        return;
    }
    if (ticket.status === 'closed') {
        await interaction.reply({ content: 'Das Ticket ist geschlossen.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (user.id === ticket.opener) {
        await interaction.reply({ content: 'Den Ersteller des Tickets kannst du nicht entfernen.', flags: MessageFlags.Ephemeral });
        return;
    }
    // Nur per /add hinzugefügte User, sonst ließe sich z.B. der Bot selbst aussperren.
    if (!ticket.added?.includes(user.id)) {
        await interaction.reply({ content: `${user} wurde nicht per /add hinzugefügt.`, flags: MessageFlags.Ephemeral });
        return;
    }
    try {
        await interaction.channel.permissionOverwrites.delete(user.id);
    } catch (error) {
        // 10009: Overwrite gibt es nicht mehr, dann ist der User schon draußen.
        if (error.code !== RESTJSONErrorCodes.UnknownPermissionOverwrite) {
            console.error(`${LOG} ${user.id} konnte nicht aus ${interaction.channel.name} entfernt werden:`, error.message);
            await interaction.reply({ content: `${user} konnte gerade nicht entfernt werden. Versuch es gleich nochmal.`, flags: MessageFlags.Ephemeral });
            return;
        }
    }
    store.removeUser(interaction.channel.id, user.id);
    console.log(`${LOG} ${user.username || user.id} aus ${interaction.channel.name} entfernt von ${interaction.user.username}`);
    await interaction.reply({ content: `${user} wurde aus dem Ticket entfernt.`, allowedMentions: { parse: [] } });
}

function canUpgrade(ticket) {
    return Boolean(ticket) && ticket.status !== 'closed' && ticket.mode !== 'console' && ticket.type !== 'bewerbung';
}

async function upgradeToConsole(channel, { by, reason = '' }) {
    const ticket = store.getTicket(channel.id);
    if (!ticket) return { ok: false, message: 'Das ist kein Ticket-Channel.' };
    if (ticket.status === 'closed') return { ok: false, message: 'Das Ticket ist bereits geschlossen.' };
    if (ticket.type === 'bewerbung') return { ok: false, message: 'Bewerbungs-Tickets können nicht hochgestuft werden.' };
    if (ticket.mode === 'console') return { ok: false, message: 'Dieses Ticket hat bereits Console-Zugang.' };

    // Rollen ohne Console-Zugang (Probe-Mod) verlieren die Sicht.
    for (const roleId of accessRoleIds(ticket.type)) {
        if (!ticketSystem.consoleAccessRoles.includes(roleId)) {
            await channel.permissionOverwrites.edit(roleId, { ViewChannel: false });
        }
    }
    await channel.edit({
        name: `console-${pad(ticket.number)}`,
        parent: ticketSystem.consoleCategoryOpen,
        lockPermissions: false,
    });
    store.setTicket(channel.id, { mode: 'console', resumedAt: Date.now() });

    const assistantTicket = ensureAssistantTicket(channel.id);
    assistantTicket.autoReplies = 0;
    setAssistantStatus(channel.id, AssistantStatus.ACTIVE_BOT);

    const client = channel.client;
    const notice = createBrandedEmbed(client)
        .setTitle('Console-Zugang')
        .setDescription('Das Ticket wurde auf Console-Zugang hochgestuft. Der Bot betreut es jetzt ohne Antwort-Limit, bis ein Teammitglied eingreift.');
    await channel.send({ embeds: [notice] });

    const notify = await client.channels.fetch(ticketSystem.consoleNotifyChannelId).catch(() => null);
    if (notify?.isTextBased()) {
        const embed = createBrandedEmbed(client)
            .setTitle('Console-Zugang')
            .setDescription(`Das Ticket ${channel} ist jetzt Console-Zugang. Bitte aktiv draufschauen.`)
            .addFields({ name: 'Ausgelöst von', value: by, inline: true });
        if (reason) embed.addFields({ name: 'Grund', value: reason.slice(0, 1000) });
        await notify.send({ embeds: [embed] }).catch(() => {});
    }
    console.log(`${LOG} ${channel.name} auf Console hochgestuft (${by})`);
    return { ok: true };
}

function setBotMode(channel, enabled) {
    const ticket = store.getTicket(channel.id);
    if (!ticket) return { ok: false, message: 'Das ist kein Ticket-Channel.' };
    if (ticket.status === 'closed') return { ok: false, message: 'Das Ticket ist bereits geschlossen.' };
    if (ticket.type === 'bewerbung') return { ok: false, message: 'In Bewerbungs-Tickets ist der Bot-Modus nicht verfügbar.' };

    if (enabled) {
        store.setTicket(channel.id, { botMode: true, paused: false, resumedAt: Date.now() });
        ensureAssistantTicket(channel.id);
        setAssistantStatus(channel.id, AssistantStatus.ACTIVE_BOT);
    } else {
        store.setTicket(channel.id, { botMode: false, paused: true });
        ensureAssistantTicket(channel.id);
        setAssistantStatus(channel.id, AssistantStatus.PAUSED_HUMAN);
    }
    return { ok: true };
}

function ticketPanelComponents() {
    const row = new ActionRowBuilder();
    for (const typeKey of ticketSystem.panelTypes) {
        const type = ticketSystem.types[typeKey];
        row.addComponents(
            new ButtonBuilder().setCustomId(`ticket_open:${typeKey}`).setLabel(type.label).setStyle(ButtonStyle.Primary),
        );
    }
    return [row];
}

async function postTicketPanel(interaction) {
    const embed = createBrandedEmbed(interaction.client)
        .setTitle('Support-Tickets')
        .setDescription('Wähle unten den passenden Bereich, um ein Ticket zu öffnen.');
    // Discord gibt nur 3 Sekunden für die erste Antwort, deshalb vorher bestätigen.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await interaction.channel.send({ embeds: [embed], components: ticketPanelComponents() });
    store.setPanel('ticket', { channelId: interaction.channel.id, messageId: message.id });
    await interaction.editReply({ content: 'Panel gepostet.' });
}

async function postBewerbungPanel(interaction) {
    const embed = createBrandedEmbed(interaction.client)
        .setTitle('PactMC Bewerbung')
        .addFields(
            { name: 'Was in deiner Bewerbung enthalten sein sollte', value: '- Information über deine Person\n- Warum möchtest du ausgerechnet PactMC unterstützen?\n- Warum sollten wir dich auswählen?\n- Welche Erfahrungen hast du bereits?\n- Was sind deine Stärken und Schwächen?' },
            { name: 'Was sind die Vorraussetzungen', value: '- Mindestalter: 16 Jahre\n- Respektvoller Umgangston\n- Verständliches und deutliches Mikrofon' },
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_open:bewerbung').setLabel('Bewerbung öffnen').setStyle(ButtonStyle.Success),
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await interaction.channel.send({ embeds: [embed], components: [row] });
    store.setPanel('bewerbung', { channelId: interaction.channel.id, messageId: message.id });
    await interaction.editReply({ content: 'Bewerbungs-Panel gepostet.' });
}

const BUTTONS = {
    ticket_close: askClose,
    ticket_close_confirm: closeTicket,
    ticket_close_cancel: dismissPrompt,
    ticket_reopen: reopenTicket,
    ticket_delete: askDelete,
    ticket_delete_confirm: deleteTicket,
    ticket_delete_cancel: dismissPrompt,
};

async function handleButton(interaction) {
    const [action, arg] = interaction.customId.split(':');
    if (action === 'ticket_open') return openTicket(interaction, arg);
    const handler = Object.hasOwn(BUTTONS, action) ? BUTTONS[action] : null;
    return handler ? handler(interaction) : undefined;
}

function cleanupOnDelete(channel) {
    if (store.getTicket(channel?.id)) {
        store.deleteTicket(channel.id);
        console.log(`${LOG} Ticket-State entfernt: ${channel.id}`);
    }
}

module.exports = {
    openTicket,
    closeTicket,
    addUserToTicket,
    removeUserFromTicket,
    postTicketPanel,
    postBewerbungPanel,
    handleButton,
    cleanupOnDelete,
    canUpgrade,
    upgradeToConsole,
    setBotMode,
};
