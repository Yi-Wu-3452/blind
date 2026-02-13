import fs from 'fs';
import path from 'path';

const urlsFile = '/Users/ywu47/Documents/blind/data/tmobile_post_urls.txt';
const postsDir = '/Users/ywu47/Documents/blind/data/tmobile_posts';
const missingFile = '/Users/ywu47/Documents/blind/data/missing_tmobile_urls.txt';

if (!fs.existsSync(urlsFile)) {
    console.error(`URLs file not found: ${urlsFile}`);
    process.exit(1);
}

if (!fs.existsSync(postsDir)) {
    console.error(`Posts directory not found: ${postsDir}`);
    process.exit(1);
}

const urls = fs.readFileSync(urlsFile, 'utf-8')
    .split('\n')
    .map(u => u.trim())
    .filter(Boolean);

const existingFiles = fs.readdirSync(postsDir)
    .filter(f => f.endsWith('.json'));

const existingSlugs = new Set(existingFiles.map(f => f.slice(0, -5)));

const missingUrls = urls.filter(url => {
    const slug = url.split('/').pop();
    return !existingSlugs.has(slug);
});

fs.writeFileSync(missingFile, missingUrls.join('\n'));
console.log(`Found ${missingUrls.length} missing URLs. Saved to ${missingFile}`);
