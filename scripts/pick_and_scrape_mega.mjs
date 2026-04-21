#!/usr/bin/env node
/**
 * pick_and_scrape_mega.mjs
 * Interactive picker for mega companies (10k+ posts).
 * URLs are read from tags/ subdirectory per company.
 *
 * Usage:
 *   node scripts/pick_and_scrape_mega.mjs --account <number> [options]
 *
 * Required:
 *   --account <number>      Account number from credentials.json (e.g. --account 1)
 *
 * Options (passed through to the extractor):
 *   --proxy socks5://...    Route through proxy
 *   --use-stealth           Enable stealth plugin
 *   --dry-run               Show selection without scraping
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const MEGA_LIST = 'company_list_over_10k.json';

const urlDir = path.join(root, 'data/company_post_urls');
const dataDir = path.join(root, 'data/company_posts');

// --- helpers ---

function safeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
}

const SKIP_FILES = ['state.json'];

function collectUrls(companyUrlDir) {
    const urlSet = new Set();
    // Root-level json files
    if (fs.existsSync(companyUrlDir)) {
        for (const f of fs.readdirSync(companyUrlDir)) {
            if (!f.endsWith('.json') || f.includes('_duplicates') || SKIP_FILES.includes(f)) continue;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(companyUrlDir, f), 'utf8'));
                data.forEach(item => item.url && urlSet.add(item.url));
            } catch { }
        }
    }
    // tags/ subdirectory
    const tagsDir = path.join(companyUrlDir, 'tags');
    if (fs.existsSync(tagsDir)) {
        for (const f of fs.readdirSync(tagsDir)) {
            if (!f.endsWith('.json') || f.includes('_duplicates')) continue;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
                data.forEach(item => item.url && urlSet.add(item.url));
            } catch { }
        }
    }
    return urlSet;
}

function getProgress(name) {
    const safe = safeName(name);
    const companyUrlDir = path.join(urlDir, safe);
    const companyPostDir = path.join(dataDir, safe);

    const urlSet = collectUrls(companyUrlDir);

    let done = 0;
    if (fs.existsSync(companyPostDir)) {
        done = fs.readdirSync(companyPostDir).filter(f => f.endsWith('.json') && f !== 'aggregated_posts.json').length;
    }

    return { total: urlSet.size, done };
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// --- main ---

const isDryRun = process.argv.includes('--dry-run');
const accIdx = process.argv.indexOf('--account');

if (accIdx === -1 && !isDryRun) {
    console.error('❌ --account <number> is required. E.g. --account 1');
    process.exit(1);
}

const passthroughArgs = process.argv.slice(2).filter(a => a !== '--dry-run').join(' ');

const megaPath = path.join(root, MEGA_LIST);
if (!fs.existsSync(megaPath)) {
    console.error(`❌ ${MEGA_LIST} not found.`);
    process.exit(1);
}

console.log('\n🔍 Loading mega company progress...\n');
const companies = JSON.parse(fs.readFileSync(megaPath, 'utf8'));
const all = companies.map(c => {
    const { total, done } = getProgress(c['Company Name']);
    const pct = total > 0 ? done / total : 0;
    return { ...c, total, done, pct };
});

const remaining = all.filter(c => c.pct < 0.95);
const done = all.filter(c => c.pct >= 0.95);

console.log(`✅ Done (≥95%): ${done.length}   ⏳ Remaining: ${remaining.length}\n`);

if (done.length > 0) {
    console.log('✅ Already done:\n');
    done.forEach(c => console.log(`      • ${c['Company Name']} (${c.done.toLocaleString()} / ${c.total.toLocaleString()} posts scraped)`));
    console.log();
}

console.log('⏳ Mega companies left to scrape:\n');
remaining.forEach((c, i) => {
    const pctStr = c.total > 0 ? `${((c.done / c.total) * 100).toFixed(0)}%` : 'no URLs';
    const bar = c.total > 0
        ? '[' + '█'.repeat(Math.round(c.pct * 10)) + '░'.repeat(10 - Math.round(c.pct * 10)) + ']'
        : '[----------]';
    console.log(`  ${String(i + 1).padStart(2)}. ${bar} ${pctStr.padStart(4)}  ${c['Company Name']} (${c.done.toLocaleString()} / ${c.total.toLocaleString()} collected URLs)`);
});

console.log('\nEnter company numbers to scrape (e.g. 1,3,5-8 or "all"):');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const input = await ask(rl, '> ');
rl.close();

// Parse selection
let selected = [];
if (input.trim().toLowerCase() === 'all') {
    selected = remaining;
} else {
    const parts = input.split(',').map(s => s.trim());
    for (const part of parts) {
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
            const from = parseInt(rangeMatch[1]);
            const to = parseInt(rangeMatch[2]);
            for (let i = from; i <= to; i++) {
                if (remaining[i - 1]) selected.push(remaining[i - 1]);
            }
        } else {
            const idx = parseInt(part);
            if (!isNaN(idx) && remaining[idx - 1]) selected.push(remaining[idx - 1]);
        }
    }
}

if (selected.length === 0) {
    console.log('\n⚠️  No companies selected. Exiting.');
    process.exit(0);
}

console.log(`\n📋 Selected ${selected.length} companies:`);
selected.forEach(c => console.log(`   • ${c['Company Name']} (${c.done}/${c.total})`));

if (isDryRun) {
    console.log('\n[dry-run] Would run extractor on the above companies.');
    process.exit(0);
}

const tempDir = path.join(root, '.temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const tempList = path.join(tempDir, `scrape_list_mega_${Date.now()}.json`);
fs.writeFileSync(tempList, JSON.stringify(selected, null, 2));

const cmd = `node scripts/core/extract_post_details.mjs --company-list=${tempList} ${passthroughArgs}`;
console.log(`\n🚀 Running: ${cmd}\n`);

try {
    execSync(cmd, { stdio: 'inherit', cwd: root });
} finally {
    fs.unlinkSync(tempList);
}
