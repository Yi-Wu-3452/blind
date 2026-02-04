import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data/posts_greedy');

function normalizeDate(dateStr, referenceDate) {
    if (!dateStr) return "";
    const cleanStr = dateStr.trim().replace(/·/g, '').trim();
    if (!cleanStr) return "";

    // If already in YYYY-MM-DD, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) return cleanStr;

    const ref = new Date(referenceDate);

    // Relative dates: "4d", "2h", "11m"
    const relMatch = cleanStr.match(/^(\d+)([dhms])$/);
    if (relMatch) {
        const val = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const d = new Date(ref);
        if (unit === 'd') d.setDate(d.getDate() - val);
        else if (unit === 'h') d.setHours(d.getHours() - val);
        else if (unit === 'm') d.setMinutes(d.getMinutes() - val);
        return d.toISOString().split('T')[0];
    }

    // Absolute dates: "Oct 30, 2025" or "Jan 19"
    if (cleanStr.includes(',')) {
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }

    const mdMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
    if (mdMatch) {
        const yr = ref.getFullYear();
        const d = new Date(`${mdMatch[1]} ${mdMatch[2]}, ${yr}`);
        if (d > ref) d.setFullYear(yr - 1);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }

    const fallback = new Date(cleanStr);
    return !isNaN(fallback.getTime()) ? fallback.toISOString().split('T')[0] : cleanStr;
}

function processReplies(replies, refDate) {
    if (!replies) return;
    for (const r of replies) {
        r.date = normalizeDate(r.date, refDate);
        processReplies(r.nested, refDate);
    }
}

function migrate() {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Processing ${files.length} files in ${DATA_DIR}...`);

    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Use file modification time as reference if scrapeTime is missing
        const stats = fs.statSync(filePath);
        const refDate = data.scrapeTime ? new Date(data.scrapeTime) : stats.mtime;

        data.date = normalizeDate(data.date, refDate);
        processReplies(data.replies, refDate);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Normalized: ${file}`);
    }
}

migrate();
