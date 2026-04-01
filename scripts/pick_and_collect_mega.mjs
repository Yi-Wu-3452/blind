#!/usr/bin/env node
/**
 * pick_and_collect_mega.mjs
 * Interactive picker for collecting post URLs for mega companies (10k+ posts).
 * Shows tag collection progress per company and runs batch_collect_mega_company_tags.mjs.
 *
 * Usage:
 *   node scripts/pick_and_collect_mega.mjs [options]
 *
 * Options (passed through to the collector):
 *   --force                 Re-collect even if tag files already exist
 *   --headless              Run browser in headless mode
 *   --stealth               Enable stealth plugin
 *   --dry-run               Show selection without collecting
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const TAGS_LIST = 'company_list_over_10k_with_tags.json';
const urlDir = path.join(root, 'data/company_post_urls');

// --- helpers ---

function safeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
}

function getCollectionProgress(company) {
    const safe = safeName(company['Company Name']);
    const tagsDir = path.join(urlDir, safe, 'tags');
    const totalTags = (company.Tags || []).length;
    // Each tag has recent + top = 2 files expected
    const expectedFiles = totalTags * 2;

    let collectedFiles = 0;
    if (fs.existsSync(tagsDir)) {
        collectedFiles = fs.readdirSync(tagsDir)
            .filter(f => f.endsWith('.json') && !f.includes('_duplicates')).length;
    }

    return { collected: collectedFiles, total: expectedFiles, totalTags };
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// --- main ---

const isDryRun = process.argv.includes('--dry-run');
const passthroughArgs = process.argv.slice(2).filter(a => a !== '--dry-run').join(' ');

const tagsListPath = path.join(root, TAGS_LIST);
if (!fs.existsSync(tagsListPath)) {
    console.error(`❌ ${TAGS_LIST} not found.`);
    process.exit(1);
}

console.log('\n🔍 Loading mega company URL collection progress...\n');
const companies = JSON.parse(fs.readFileSync(tagsListPath, 'utf8'));
const all = companies.map(c => {
    const { collected, total, totalTags } = getCollectionProgress(c);
    const pct = total > 0 ? collected / total : 0;
    return { ...c, collected, total, totalTags, pct };
});

const remaining = all.filter(c => c.pct < 0.95);
const done = all.filter(c => c.pct >= 0.95);

console.log(`✅ Done (≥95%): ${done.length}   ⏳ Remaining: ${remaining.length}\n`);
console.log('Mega companies left to collect URLs for:\n');
remaining.forEach((c, i) => {
    const pctStr = c.total > 0 ? `${((c.pct) * 100).toFixed(0)}%` : 'not started';
    const bar = c.total > 0
        ? '[' + '█'.repeat(Math.round(c.pct * 10)) + '░'.repeat(10 - Math.round(c.pct * 10)) + ']'
        : '[----------]';
    console.log(`  ${String(i + 1).padStart(2)}. ${bar} ${pctStr.padStart(11)}  ${c['Company Name']} (${c.collected}/${c.total} tag files, ${c.totalTags} tags)`);
});

console.log('\nEnter company numbers to collect (e.g. 1,3,5-8 or "all"):');

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
selected.forEach(c => console.log(`   • ${c['Company Name']} (${c.collected}/${c.total} tag files)`));

if (isDryRun) {
    console.log('\n[dry-run] Would run URL collector on the above companies.');
    process.exit(0);
}

// Run collector per company
for (const c of selected) {
    const cmd = `node scripts/core/batch_collect_mega_company_tags.mjs --company="${c['Company Name']}" ${passthroughArgs}`;
    console.log(`\n🚀 Running: ${cmd}\n`);
    execSync(cmd, { stdio: 'inherit', cwd: root });
}
