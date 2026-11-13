const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const { serverLogs } = require('../../config');
const { sanitizeLine } = require('./sanitize');

const LOG_FILE = /^(latest\.log|\d{4}-\d{2}-\d{2}-\d+\.log(\.gz)?)$/;

async function listFiles(dir, sinceHours) {
    const cutoff = Date.now() - sinceHours * 3600 * 1000;
    const files = [];
    for (const name of await fs.promises.readdir(dir)) {
        if (!LOG_FILE.test(name)) continue;
        const stat = await fs.promises.stat(path.join(dir, name));
        if (name === 'latest.log' || stat.mtimeMs >= cutoff) files.push({ name, mtime: stat.mtimeMs });
    }
    files.sort((a, b) => a.mtime - b.mtime);
    return files.slice(-serverLogs.maxFiles);
}

function labelOf(name) {
    return name === 'latest.log' ? 'latest' : name.slice(0, 10);
}

// Liest eine Datei zeilenweise (gz wird gestreamt) und ruft onLine für jede Zeile auf.
// Ist eine normale Datei größer als maxBytesPerFile, wird nur ihr Ende gelesen, denn dort
// stehen die neuesten Einträge. Bei gz geht das nicht, dort zählt der Anfang.
async function scanFile(file, onLine) {
    const gz = file.endsWith('.gz');
    const size = gz ? 0 : (await fs.promises.stat(file)).size;
    const start = Math.max(0, size - serverLogs.maxBytesPerFile);
    const source = fs.createReadStream(file, { start });
    const input = gz ? source.pipe(zlib.createGunzip()) : source;
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let bytes = 0;
    let skipPartial = start > 0;
    try {
        for await (const line of rl) {
            // Beim Einstieg mitten in die Datei ist die erste Zeile abgeschnitten.
            if (skipPartial) {
                skipPartial = false;
                continue;
            }
            bytes += line.length + 1;
            if (bytes > serverLogs.maxBytesPerFile) break;
            onLine(line);
        }
    } finally {
        rl.close();
        source.destroy();
        input.destroy();
    }
}

// Gibt die letzten maxLines passenden Zeilen zurück. Alle Suchbegriffe müssen vorkommen.
// transform bekommt die Rohzeile und liefert die Zeile zurück, die gezeigt werden darf, oder null.
async function queryLogs({ server, terms, sinceHours, maxLines, transform = (line) => line }) {
    const dir = serverLogs.paths[server];
    let files;
    try {
        files = await listFiles(dir, sinceHours);
    } catch {
        return { status: 'unavailable' };
    }
    if (!files.length) return { status: 'no_matches', matches: 0, files: 0, lines: [] };

    const needles = terms.map((t) => t.toLowerCase());
    const kept = [];
    let matches = 0;

    for (const file of files) {
        const label = labelOf(file.name);
        await scanFile(path.join(dir, file.name), (line) => {
            // Grobfilter auf der Rohzeile spart Arbeit. Entscheidend ist aber die Zeile, die der
            // Spieler sehen darf: sonst ließe sich über Trefferzahlen z.B. testen, wem eine IP gehört.
            const lower = line.toLowerCase();
            if (!needles.every((n) => lower.includes(n))) return;
            const visible = transform(line);
            if (visible === null) return;
            const clean = sanitizeLine(visible);
            const cleanLower = clean.toLowerCase();
            if (!needles.every((n) => cleanLower.includes(n))) return;
            matches += 1;
            kept.push(`[${label}] ${clean}`);
            if (kept.length > maxLines) kept.shift();
        });
    }

    return { status: matches ? 'ok' : 'no_matches', matches, files: files.length, lines: kept };
}

module.exports = { queryLogs };
