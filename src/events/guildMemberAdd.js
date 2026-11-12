const { Events } = require('discord.js');
const { welcomeChannelId } = require('../config');

module.exports = {
    name: Events.GuildMemberAdd,

    execute(member) {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        channel?.send(`Hey <@${member.id}> Herzlich willkommen auf **PactMC**! 🎉🤗\nLies dir bitte in <#940232290628419650> die Regeln durch.`)
            .catch((error) => console.error('Willkommensnachricht fehlgeschlagen:', error));

        member.send(`Hey <@${member.id}>! Das ganze Team von **PactMC** wünscht dich noch einmal herzlich willkommen auf unserem Server und wir wünschen dir viel Spaß.\nBei Fragen kannst du unter <#1076595592647684166> ein Ticket erstellen.`)
            .catch(() => {}); // Direktnachrichten sind bei vielen Usern aus
    },
};
