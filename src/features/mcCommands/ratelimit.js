const buckets = new Map();
const SWEEP_AT = 2000;
const MAX_WINDOW_MS = 60 * 60 * 1000;

function sweep(now) {
    for (const [key, times] of buckets) {
        if (!times.length || now - times[times.length - 1] > MAX_WINDOW_MS) buckets.delete(key);
    }
}

// Gleitendes Fenster: erlaubt maximal `limit` Treffer pro Fenster.
function hit(key, limit, windowMs = 60 * 1000) {
    const now = Date.now();
    if (buckets.size > SWEEP_AT) sweep(now);
    const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
        buckets.set(key, recent);
        return false;
    }
    recent.push(now);
    buckets.set(key, recent);
    return true;
}

module.exports = { hit };
