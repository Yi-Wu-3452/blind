import fs from 'fs';
import path from 'path';

const IN_FILE = 'data/posts_greedy/is-nvidia-really-fcked-like-everyone-says-uakgdxh7.json';

if (!fs.existsSync(IN_FILE)) {
    console.error(`File not found: ${IN_FILE}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
const replies = data.replies || [];

console.log(`Checking ${replies.length} top-level replies in ${IN_FILE}:`);

let mismatchCount = 0;
replies.forEach((reply, index) => {
    const actualCount = reply.nested ? reply.nested.length : 0;
    const expectedCount = reply.expectedNestedCount;

    if (expectedCount !== undefined && actualCount !== expectedCount) {
        console.log(`Mismatch at reply index ${index} (User: ${reply.userName}): Expected ${expectedCount}, Found ${actualCount}`);
        mismatchCount++;
    }
});

if (mismatchCount === 0) {
    console.log("SUCCESS: All nested counts match the expected counts!");
} else {
    console.log(`FAILURE: ${mismatchCount} mismatches found.`);
}

// Calculate total comments (top-level + nested)
const totalScraped = replies.reduce((acc, reply) => {
    return acc + 1 + (reply.nested ? reply.nested.length : 0);
}, 0);

const metadataCount = parseInt(data.commentsCount, 10);

console.log(`\n--- Total Comment Verification ---`);
console.log(`Metadata 'commentsCount': ${metadataCount}`);
console.log(`Total Scraped Comments (Top-level + Nested): ${totalScraped}`);

if (totalScraped === metadataCount) {
    console.log("SUCCESS: Total scraped count matches metadata count!");
} else {
    console.log(`WARNING: Mismatch in total count. Difference: ${metadataCount - totalScraped}`);
    if (metadataCount > totalScraped) {
        console.log("Possible causes: Hidden/deleted comments, pagination limits, or 'View more' issues.");
    } else {
        console.log("Possible causes: Duplicate scraping or metadata lag.");
    }
}
