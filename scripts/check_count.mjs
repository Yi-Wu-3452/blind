import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];

if (!filePath) {
    console.error("Please provide a JSON file path.");
    process.exit(1);
}

try {
    const data = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));
    console.log(`\n📊 Count Report for: ${path.basename(filePath)}`);
    console.log(`--------------------------------------------------`);
    console.log(`Metadata commentsCount:      ${data.commentsCount}`);
    console.log(`Metadata scrapedCommentsCount: ${data.scrapedCommentsCount}`);
    console.log(`Length of 'replies' array:    ${data.replies.length}`);

    const flaggedCount = data.replies.filter(r => r.isFlagged).length;
    console.log(`Top-level flagged comments:   ${flaggedCount}`);
    console.log(`--------------------------------------------------\n`);
} catch (e) {
    console.error(`Error reading or parsing file: ${e.message}`);
}
