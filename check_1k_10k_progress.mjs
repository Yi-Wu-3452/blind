import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companyListPath = path.resolve(__dirname, './company_list_1000_to_10K.json');
const urlDir = path.resolve(__dirname, './data/company_post_urls');
const dataDir = path.resolve(__dirname, './data/company_posts');

if (!fs.existsSync(companyListPath)) {
    console.error('Company list not found');
    process.exit(1);
}

const companies = JSON.parse(fs.readFileSync(companyListPath, 'utf8'));
const results = [];

for (const company of companies) {
    const companyName = company["Company Name"];
    const safeName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
    const companyUrlDir = path.join(urlDir, safeName);
    const companyPostDir = path.join(dataDir, safeName);
    const recentJsonPath = path.join(companyUrlDir, `${safeName}_recent.json`);

    let totalUrls = 0;
    if (fs.existsSync(recentJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(recentJsonPath, 'utf8'));
            totalUrls = data.length;
        } catch (e) { }
    }

    let doneCount = 0;
    if (fs.existsSync(companyPostDir)) {
        const files = fs.readdirSync(companyPostDir);
        doneCount = files.filter(f => f.endsWith('.json')).length;
    }

    results.push({
        name: companyName,
        safeName,
        total: totalUrls,
        done: doneCount,
        percent: totalUrls > 0 ? ((doneCount / totalUrls) * 100).toFixed(1) + '%' : '0%'
    });
}

console.log('| Company | Total URLs | Done | Progress |');
console.log('|---------|------------|------|----------|');
results.forEach(r => {
    console.log(`| ${r.name} | ${r.total} | ${r.done} | ${r.percent} |`);
});

const fullyDone = results.filter(r => r.total > 0 && r.done >= r.total).length;
const started = results.filter(r => r.done > 0).length;

console.log(`\nSummary: ${fullyDone}/${companies.length} companies fully done. ${started} companies started.`);
