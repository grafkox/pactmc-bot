const { randomInt } = require('node:crypto');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { createBrandedEmbed } = require('../../utils/embed');
const store = require('../ticketSystem/store');
const { execute } = require('../mcCommands/rcon');
const { hit } = require('../mcCommands/ratelimit');
const log = require('../ticketAssistant/log');

const VERIFY_TIMEOUT_MS = 15 * 60 * 1000; // so lange wartet die Anfrage insgesamt
const CODE_TTL_MS = 10 * 60 * 1000; // so lange gilt ein einzelner Code
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 3;
const LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // danach wird neu bestätigt
// Gegen Belästigung und Durchprobieren: Codes pro Ingame-Name und pro Discord-User je Stunde.
const SENDS_PER_NAME_PER_HOUR = 6;
const SENDS_PER_USER_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

const PLAYER = /^\.?[A-Za-z0-9_]{1,16}$/;
const NOT_FOUND = /no player was found|player not found|spieler nicht gefunden|not online/i;
const CODE = /^\s*(\d{6})\s*$/;

// channelId -> laufende Bestätigung
const pending = new Map();

function isValidName(name) {
    return PLAYER.test(String(name ?? ''));
}

// Bestätigter Name des Users oder null. Alte Verknüpfungen müssen neu bestätigt werden.
function verifiedName(discordId) {
    const link = store.getLink(discordId);
    if (!link || Date.now() - link.verifiedAt > LINK_MAX_AGE_MS) return null;
    return link.name;
}

function buttons(state) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_resend').setLabel('Code neu senden').setStyle(ButtonStyle.Primary),
    );
    if (state.notFound) {
        row.addComponents(
            new ButtonBuilder().setCustomId('verify_rename').setLabel('Namen ändern').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('verify_nojoin').setLabel('Ich kann nicht joinen').setStyle(ButtonStyle.Danger),
        );
    }
    return [row];
}

function view(state, client) {
    const embed = createBrandedEmbed(client).setTitle('Ingame-Namen bestätigen');
    if (state.notFound) {
        embed.setDescription(
            `**${state.name}** ist gerade nicht auf dem Server, der Code konnte nicht zugestellt werden.\n\n`
            + 'Join dem Server und schick den Code neu. Falls der Name falsch ist, kannst du ihn ändern.',
        );
    } else {
        embed.setDescription(
            `Damit ich Server-Daten zu **${state.name}** abrufen kann, bestätige bitte, dass der Account dir gehört.\n\n`
            + 'Ich habe dir ingame eine private Nachricht mit einem 6-stelligen Code geschickt. '
            + 'Schreib den Code hier ins Ticket. Er ist 10 Minuten gültig.\n\n'
            + '**Gib den Code unter keinen Umständen an andere weiter, auch nicht an Teammitglieder.**',
        );
    }
    return { content: `<@${state.userId}>`, embeds: [embed], components: buttons(state), allowedMentions: { users: [state.userId] } };
}

async function refresh(state, client) {
    await state.message?.edit(view(state, client)).catch(() => {});
}

async function finish(state, status, client, text) {
    if (pending.get(state.channelId) !== state) return;
    pending.delete(state.channelId);
    clearTimeout(state.timer);
    const embed = createBrandedEmbed(client).setTitle('Ingame-Namen bestätigen').setDescription(text);
    await state.message?.edit({ content: '', embeds: [embed], components: [] }).catch(() => {});
    log.info(`#${state.channelName} | Verifizierung ${state.name}: ${status}`);
    state.resolve({ status, name: state.name });
}

// Schickt einen neuen Code per RCON. Gibt false zurück, wenn die Bestätigung damit beendet ist.
async function sendCode(state, client) {
    if (state.sends >= MAX_SENDS) {
        await finish(state, 'verification_failed', client, 'Zu viele Versuche. Die Bestätigung wurde abgebrochen.');
        return false;
    }
    const nameOk = hit(`verify:name:${state.name.toLowerCase()}`, SENDS_PER_NAME_PER_HOUR, HOUR_MS);
    if (!nameOk || !hit(`verify:user:${state.userId}`, SENDS_PER_USER_PER_HOUR, HOUR_MS)) {
        await finish(state, 'verification_failed', client, 'Es wurden zu viele Codes angefordert. Versuch es in einer Stunde erneut.');
        return false;
    }
    state.sends += 1;
    state.lastSentAt = Date.now();
    state.code = null;

    const code = String(randomInt(100000, 1000000));
    let output;
    try {
        output = await execute('leaf', `msg ${state.name} Dein PactMC-Ticket-Code: ${code}. Gib ihn nur selbst im Discord-Ticket ein und gib ihn unter keinen Umständen an andere weiter, auch nicht an Teammitglieder.`);
    } catch (error) {
        log.error(`#${state.channelName} | Verifizierungs-Code nicht zustellbar:`, error);
        await finish(state, 'verification_unavailable', client, 'Der Server ist gerade nicht erreichbar, die Bestätigung ist nicht möglich.');
        return false;
    }

    state.notFound = NOT_FOUND.test(output);
    if (!state.notFound) {
        state.code = code;
        state.codeSentAt = Date.now();
        state.attempts = 0;
    }
    await refresh(state, client);
    return true;
}

// Startet die Bestätigung und wartet, bis sie abgeschlossen ist.
// Ergebnis: verified, no_connection, verification_timeout, verification_failed, verification_unavailable.
async function verify({ channel, client, userId, name }) {
    if (!isValidName(name)) return { status: 'verification_required' };
    if (pending.has(channel.id)) return { status: 'verification_busy', name };

    const state = {
        channelId: channel.id,
        channelName: channel.name,
        userId,
        name,
        code: null,
        attempts: 0,
        sends: 0,
        notFound: false,
    };
    const result = new Promise((resolve) => { state.resolve = resolve; });
    pending.set(channel.id, state);

    try {
        state.message = await channel.send(view(state, client));
    } catch (error) {
        pending.delete(channel.id);
        throw error;
    }
    state.timer = setTimeout(() => {
        finish(state, 'verification_timeout', client, 'Die Bestätigung ist abgelaufen.');
    }, VERIFY_TIMEOUT_MS);
    await sendCode(state, client);
    return result;
}

// Bricht eine laufende Bestätigung ab, z.B. wenn das Ticket geschlossen wird.
function cancel(channelId, client) {
    const state = pending.get(channelId);
    if (state) finish(state, 'verification_timeout', client, 'Die Bestätigung wurde abgebrochen.').catch(() => {});
}

// Bestätigung ohne Log-Abfrage, z.B. bevor ein Befehl für den Spieler selbst laufen soll.
async function ensureVerified({ channel, client, userId, name }) {
    const current = verifiedName(userId);
    if (current) return { status: 'verified', name: current };
    if (!name || !isValidName(name)) return { status: 'verification_required' };
    return verify({ channel, client, userId, name });
}

// Fängt Code-Eingaben ab. Gibt true zurück, wenn die Nachricht ein Bestätigungsversuch war.
async function handleMessage(message) {
    const state = pending.get(message.channel.id);
    if (!state || message.author.id !== state.userId) return false;
    const match = CODE.exec(message.content || '');
    if (!match) return false;

    const { client } = message;
    // Als Embed, damit diese Hinweise nicht als Bot-Antwort zählen und nicht im KI-Kontext landen.
    const send = (text) => message.channel.send({ embeds: [new EmbedBuilder().setDescription(text)] }).catch(() => {});

    if (!state.code) {
        await send('Gerade gibt es keinen gültigen Code. Schick dir über den Button einen neuen.');
        return true;
    }
    if (Date.now() - state.codeSentAt > CODE_TTL_MS) {
        state.code = null;
        await send('Der Code ist abgelaufen. Schick dir über den Button einen neuen.');
        return true;
    }
    if (match[1] === state.code) {
        store.setLink(state.userId, state.name);
        await finish(state, 'verified', client, `Bestätigt: **${state.name}** gehört zu <@${state.userId}>.`);
        return true;
    }

    state.attempts += 1;
    if (state.attempts >= MAX_ATTEMPTS) {
        await send(`Der Code war ${MAX_ATTEMPTS}-mal falsch. Ich schicke dir ingame einen neuen.`);
        await sendCode(state, client);
    } else {
        const left = MAX_ATTEMPTS - state.attempts;
        await send(`Der Code stimmt nicht. Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}.`);
    }
    return true;
}

async function guard(interaction) {
    const state = pending.get(interaction.channel.id);
    if (!state) {
        await interaction.reply({ content: 'Diese Bestätigung ist nicht mehr aktiv.', flags: MessageFlags.Ephemeral });
        return null;
    }
    if (interaction.user.id !== state.userId) {
        await interaction.reply({ content: `Nur <@${state.userId}> kann das bestätigen.`, flags: MessageFlags.Ephemeral });
        return null;
    }
    return state;
}

async function cooldownLeft(interaction, state) {
    const wait = Math.ceil((state.lastSentAt + RESEND_COOLDOWN_MS - Date.now()) / 1000);
    if (wait <= 0) return false;
    await interaction.reply({ content: `Bitte warte noch ${wait} Sekunden, bevor ein neuer Code gesendet wird.`, flags: MessageFlags.Ephemeral });
    return true;
}

async function handleInteraction(interaction) {
    const { customId, client } = interaction;

    if (interaction.isModalSubmit() && customId === 'verify_name_modal') {
        const state = await guard(interaction);
        if (!state) return;
        const name = interaction.fields.getTextInputValue('name').trim();
        if (!isValidName(name)) {
            await interaction.reply({ content: 'Das ist kein gültiger Minecraft-Name.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (await cooldownLeft(interaction, state)) return;
        await interaction.deferUpdate();
        state.name = name;
        await sendCode(state, client);
        return;
    }

    if (!interaction.isButton()) return;
    const state = await guard(interaction);
    if (!state) return;

    if (customId === 'verify_resend') {
        if (await cooldownLeft(interaction, state)) return;
        await interaction.deferUpdate();
        await sendCode(state, client);
    } else if (customId === 'verify_rename') {
        const modal = new ModalBuilder().setCustomId('verify_name_modal').setTitle('Ingame-Namen ändern').addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Dein Minecraft-Name')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(17)
                    .setValue(state.name)
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
    } else if (customId === 'verify_nojoin') {
        await interaction.deferUpdate();
        await finish(state, 'no_connection', client, 'Bestätigung abgebrochen, weil du gerade nicht auf den Server kommst.');
    }
}

module.exports = { verify, ensureVerified, verifiedName, handleMessage, handleInteraction, isValidName, cancel };
