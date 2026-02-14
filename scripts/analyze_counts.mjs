import fs from 'fs';

const filePath = process.argv[2];
if (!filePath) {
    console.error('Missing file path');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const allIds = [];
const countRecursive = (list) => {
    let count = 0;
    for (const item of list) {
        allIds.push(item.commentId);
        count++;
        if (item.nested) {
            count += countRecursive(item.nested);
        }
    }
    return count;
};

const total = countRecursive(data.replies);
const unique = new Set(allIds);

console.log(`Total comments (with nesting): ${total}`);
console.log(`Unique comment IDs: ${unique.size}`);
console.log(`Comments Count (meta): ${data.commentsCount}`);
console.log(`Scraped Comments Count: ${data.scrapedCommentsCount}`);

if (total !== unique.size) {
    console.log('\nDUPLICATE IDS FOUND:');
    const counts = {};
    allIds.forEach(id => counts[id] = (counts[id] || 0) + 1);
    Object.keys(counts).forEach(id => {
        if (counts[id] > 1) {
            console.log(`  ${id}: ${counts[id]} times`);
        }
    });
}
