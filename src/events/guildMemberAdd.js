const { Events } = require('discord.js');
const { welcomeChannelId, rulesChannelId, ticketPanelChannelId } = require('../config');

module.exports = {
    name: Events.GuildMemberAdd,

    execute(member) {
        if (member.user.bot) return;
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        channel?.send(`Hey <@${member.id}> Herzlich willkommen auf **PactMC**! 🎉🤗\nLies dir bitte in <#${rulesChannelId}> die Regeln durch.`)
            .catch((error) => console.error('Willkommensnachricht fehlgeschlagen:', error));

        member.send(`Hey <@${member.id}>! Das ganze Team von **PactMC** wünscht dich noch einmal herzlich willkommen auf unserem Server und wir wünschen dir viel Spaß.\nBei Fragen kannst du unter <#${ticketPanelChannelId}> ein Ticket erstellen.`)
            .catch(() => {}); // Direktnachrichten sind bei vielen Usern aus
    },
};
