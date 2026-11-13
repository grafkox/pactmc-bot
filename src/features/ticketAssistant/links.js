// Modelltext darf keine getarnten Links posten: [Text](URL) zeigt sonst einen harmlosen Text
// und führt woandershin. Die URL bleibt sichtbar, die Vorschau wird unterdrückt.
function defuseLinks(text) {
    return String(text ?? '')
        .replace(/\[([^\]]*)\]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/gi, '$1 (<$2>)')
        .replace(/(^|[^<])(https?:\/\/[^\s<>]+)/gi, (all, before, url) => {
            // Satzzeichen am Ende gehören zum Satz, nicht zur URL.
            const trail = url.match(/[.,!?;:)]+$/)?.[0] || '';
            return `${before}<${url.slice(0, url.length - trail.length)}>${trail}`;
        });
}

module.exports = { defuseLinks };
