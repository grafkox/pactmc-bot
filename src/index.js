require('dotenv').config();

const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');

const client = new Client({
    // Nur was der Bot nutzt: Channels und Rollen, Beitritte, Support-Warteraum, Nachrichten in Tickets.
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.commands = new Collection();

client.on(Events.Error, (error) => console.error('Client error:', error));
client.on(Events.Warn, (warning) => console.warn('Client warning:', warning));

process.on('unhandledRejection', (reason) => console.error('unhandledRejection', reason));
// Nach einem unbehandelten Fehler ist der Zustand unklar. Lieber neu starten (Docker: restart unless-stopped).
process.on('uncaughtException', (error) => {
    console.error('uncaughtException, Bot wird neu gestartet:', error);
    process.exit(1);
});

async function start() {
    loadEvents(client);
    await loadCommands(client);
    await client.login(process.env.DISCORD_BOT_TOKEN);
}

// Ohne Login läuft der Prozess sonst ohne Verbindung weiter und Docker startet ihn nicht neu.
start().catch((error) => {
    console.error('Bot konnte nicht starten:', error);
    process.exit(1);
});

// node läuft im Container als PID 1 und beendet sich bei SIGTERM nicht von selbst,
// docker stop würde sonst 10 Sekunden warten und hart abbrechen.
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
        console.log(`${signal} erhalten, Bot wird beendet.`);
        client.destroy().finally(() => process.exit(0));
    });
}
