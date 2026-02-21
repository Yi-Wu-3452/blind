
const fs = require('fs');
const path = require('path');

const urlFile = 'data/tmobile_robust_recent_post_urls.txt';
const outputDir = 'data/tmobile_posts';

if (!fs.existsSync(outputDir)) {
    console.log(`Output directory ${outputDir} does not exist.`);
    process.exit(1);
}

// 1. Get expected filenames from URL list
const urls = fs.readFileSync(urlFile, 'utf-8').split('\n').filter(Boolean);
const expectedFiles = new Set();
urls.forEach(url => {
    try {
        const slug = url.split('/').pop().split('?')[0];
        expectedFiles.add(`${slug}.json`);
    } catch (e) {
        console.error(`Error processing URL: ${url}`, e);
    }
});

// 2. Get actual filenames in directory
const actualFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));

// 3. Find extras (in directory but not in list)
const extras = actualFiles.filter(f => !expectedFiles.has(f));

// 4. Find missing (in list but not in directory)
const missing = Array.from(expectedFiles).filter(f => !actualFiles.includes(f));

console.log(`URL List Count: ${urls.length}`);
console.log(`Directory File Count: ${actualFiles.length}`);
console.log(`Extra Files (Old/Zombie Data): ${extras.length}`);
console.log(`Missing Scrapes (New Data To-Do): ${missing.length}`);

if (extras.length > 0) {
    console.log('\n--- Sample Extra Files ---');
    extras.slice(0, 10).forEach(f => console.log(f));
}

if (missing.length > 0) {
    console.log('\n--- Sample Missing Scrapes ---');
    missing.slice(0, 10).forEach(f => console.log(f));
}
