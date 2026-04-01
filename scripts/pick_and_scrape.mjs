#!/usr/bin/env node
/**
 * pick_and_scrape.mjs
 * Interactive picker: shows remaining companies, lets you select which to scrape.
 *
 * Usage:
 *   node scripts/pick_and_scrape.mjs [options]
 *
 * Options (passed through to the extractor):
 *   --auto-login            Auto-login with credentials.json
 *   --account 2             Use account #2 from credentials.json
 *   --proxy socks5://...    Route through proxy
 *   --dry-run               Show selection without scraping
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const COMPANY_LISTS = [
    'company_list_1000_to_10K.json',
    'company_list_100_to_1000.json',
    'company_list_under_100.json',
];

const urlDir = path.join(root, 'data/company_post_urls');
const dataDir = path.join(root, 'data/company_posts');

// --- helpers ---

function safeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
}

function getProgress(name) {
    const safe = safeName(name);
    const companyUrlDir = path.join(urlDir, safe);
    const companyPostDir = path.join(dataDir, safe);

    const urlSet = new Set();
    for (const suffix of ['_recent.json', '_top.json']) {
        const p = path.join(companyUrlDir, `${safe}${suffix}`);
        if (fs.existsSync(p)) {
            try {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                data.forEach(item => item.url && urlSet.add(item.url));
            } catch { }
        }
    }

    let done = 0;
    if (fs.existsSync(companyPostDir)) {
        done = fs.readdirSync(companyPostDir).filter(f => f.endsWith('.json') && f !== 'aggregated_posts.json').length;
    }

    return { total: urlSet.size, done };
}

function loadAllCompanies() {
    const all = [];
    for (const listFile of COMPANY_LISTS) {
        const p = path.join(root, listFile);
        if (!fs.existsSync(p)) continue;
        const companies = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const c of companies) {
            const { total, done } = getProgress(c['Company Name']);
            const pct = total > 0 ? done / total : 0;
            all.push({ ...c, total, done, pct, listFile });
        }
    }
    return all;
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// --- main ---

const passthroughArgs = process.argv.slice(2).filter(a => a !== '--dry-run').join(' ');
const isDryRun = process.argv.includes('--dry-run');

console.log('\n🔍 Loading company progress...\n');
const all = loadAllCompanies();
const remaining = all.filter(c => c.pct < 0.95);
const done = all.filter(c => c.pct >= 0.95);

console.log(`✅ Done (≥95%): ${done.length}   ⏳ Remaining: ${remaining.length}\n`);
console.log('Companies left to scrape:\n');
remaining.forEach((c, i) => {
    const pctStr = c.total > 0 ? `${((c.done / c.total) * 100).toFixed(0)}%` : 'no URLs';
    const bar = c.total > 0
        ? '[' + '█'.repeat(Math.round(c.pct * 10)) + '░'.repeat(10 - Math.round(c.pct * 10)) + ']'
        : '[----------]';
    console.log(`  ${String(i + 1).padStart(2)}. ${bar} ${pctStr.padStart(4)}  ${c['Company Name']} (${c.done}/${c.total})`);
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

// Group by list file and run extractor per group
const groups = {};
for (const c of selected) {
    if (!groups[c.listFile]) groups[c.listFile] = [];
    groups[c.listFile].push(c);
}

for (const [listFile, companies] of Object.entries(groups)) {
    // Write a temp company list
    const tempList = path.join(root, `.temp_scrape_list_${Date.now()}.json`);
    fs.writeFileSync(tempList, JSON.stringify(companies, null, 2));

    const cmd = `node scripts/core/extract_post_details.mjs --company-list=${tempList} ${passthroughArgs}`;
    console.log(`\n🚀 Running: ${cmd}\n`);

    try {
        execSync(cmd, { stdio: 'inherit', cwd: root });
    } finally {
        fs.unlinkSync(tempList);
    }
}
