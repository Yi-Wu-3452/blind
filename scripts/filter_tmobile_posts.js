
const fs = require('fs');
const path = require('path');

const urlFile = 'data/tmobile_robust_recent_post_urls.txt';
const outputDir = 'data/tmobile_posts';
const todoFile = 'data/tmobile_posts_todo.txt';

if (!fs.existsSync(outputDir)) {
    console.log(`Output directory ${outputDir} does not exist. Creating it.`);
    fs.mkdirSync(outputDir, { recursive: true });
}

const urls = fs.readFileSync(urlFile, 'utf-8').split('\n').filter(Boolean);
const existingFiles = new Set(fs.readdirSync(outputDir));

const todoUrls = urls.filter(url => {
    try {
        const slug = url.split('/').pop().split('?')[0];
        const filename = `${slug}.json`;
        return !existingFiles.has(filename);
    } catch (e) {
        console.error(`Error processing URL: ${url}`, e);
        return false;
    }
});

fs.writeFileSync(todoFile, todoUrls.join('\n'));
console.log(`Total URLs: ${urls.length}`);
console.log(`Already scraped: ${urls.length - todoUrls.length}`);
console.log(`To do: ${todoUrls.length}`);
console.log(`Saved to ${todoFile}`);
