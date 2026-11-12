const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const { createBrandedEmbed } = require('../utils/embed');
const { isOwner } = require('../utils/isOwner');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rules')
        .setDescription('Sendet die Regeln des Servers')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        if (!isOwner(interaction.member)) {
            await interaction.reply({
                content: 'Du hast nicht die Berechtigung diesen Command zu nutzen!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const embed = createBrandedEmbed(client)
            .setTitle('PactMC Regeln')
            .addFields(
                { name: 'Discord Server', value: '**1.** User müssen sich an die TOS von Discord halten.\n**2.** Jeder Nutzer hat das Recht respektvoll behandelt zu werden. Die Verletzung dieses Rechts kann zu Konsequenzen führen.\n**3.** Den Anweisungen von Teammitgliedern ist stets Folge zu leisten.\n**4.** Administratoren haben immer das letzte Wort.\n**5.** Das anschreiben von Teammitgliedern ist verboten! Wenn ihr Hilfe braucht, könnt ihr im <#1076595592647684166> ein Ticket aufmachen!\n**6.** Unabgesprochene Eigenwerbung ist verboten und kann bestraft werden.\n**7.** Das grundlose Pingen / Markieren von Nutzern ist untersagt.\n**8.** NSFW-Inhalte sind in allen Channeln strengstens verboten.\n**9.** Spammen ist verboten.\n**10.** Trolling ist in Sprach- sowie Textchanneln verboten.' },
                { name: 'Minecraft Server', value: '**1.** Schummeln ist verboten! Darunter versteht man alles, was Vorteile gegenüber anderen bietet, wie z.B. X-Ray, Fly, AutoBuild, AutoClicker, oder ähnliches wie Bugs ausnutzen.\n**2.** Spammen von Nachrichten ist verboten und kann bestraft werden.\n**3.** Griefen oder Trollen jeglicher Art ist strengstens verboten und wird normalerweise mit einem 7 Tage Bann bestraft. Dazu gehört z.B. jegliche Blöcke abbauen von anderen Spielern, Items aus Kisten klauen, Villager von Spielern töten, ...\nIn Supportfällen werden nur Items erstattet, wenn ihr einen Clip habt, der beweisen kann, dass ihr gegrieft oder getrollt wurdet!\n**4.** Ihr dürft andere Spieler angreifen und die Items behalten, die der Spieler bei seinem Tot gedroppt hat. Danach geht ihr von der gegnerischen Basis weg und tötet nicht nocheinmal den Spieler, es sei denn dieser greift euch zuerst wieder an.\n**5.** Jegliche Versuche, die Performance des Servers zu mindern sind strengstens verboten.' },
            );

        await interaction.reply({ embeds: [embed] });
    },
};
