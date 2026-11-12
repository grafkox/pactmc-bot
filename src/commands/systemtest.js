const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType } = require('discord.js');
const { createBrandedEmbed } = require('../utils/embed');
const { isOwner } = require('../utils/isOwner');
const { runSystemTest } = require('../features/systemTest');

const ICONS = { ok: ':white_check_mark:', warn: ':warning:', fail: ':x:', info: ':information_source:' };
const FIELD_LIMIT = 1024;

// Teilt die Zeilen eines Abschnitts auf mehrere Felder auf, falls sie nicht in eines passen.
function toFields(section) {
    const fields = [];
    let current = '';
    for (const check of section.checks) {
        const line = `${ICONS[check.status]} ${check.text}`.slice(0, FIELD_LIMIT);
        if (current && current.length + line.length + 1 > FIELD_LIMIT) {
            fields.push(current);
            current = '';
        }
        current += (current ? '\n' : '') + line;
    }
    if (current) fields.push(current);
    return fields.map((value, i) => ({ name: i ? `${section.title} (${i + 1})` : section.title, value }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('systemtest')
        .setDescription('Prüft Discord-Rechte, Open WebUI, RCON, Logs und Daten des Bots')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption((option) =>
            option.setName('modelle').setDescription('Modelle mit je einer Testanfrage prüfen, kostet ein paar Tokens (Standard: ja)'),
        ),

    async execute(interaction, client) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: 'Dazu fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const deep = interaction.options.getBoolean('modelle') ?? true;
        const sections = await runSystemTest(interaction.guild, { deep });

        const all = sections.flatMap((section) => section.checks);
        const fails = all.filter((check) => check.status === 'fail').length;
        const warns = all.filter((check) => check.status === 'warn').length;
        const summary = fails || warns ? `${fails} Fehler, ${warns} Warnungen` : 'Alles in Ordnung';
        console.log(`[Systemtest] ${summary} (${interaction.user.username})`);

        const embed = createBrandedEmbed(client)
            .setTitle('Systemtest')
            .setDescription(summary)
            .setColor(fails ? 0xed4245 : warns ? 0xfee75c : 0x57f287)
            .addFields(sections.flatMap(toFields).slice(0, 25));
        await interaction.editReply({ embeds: [embed] });
    },
};
