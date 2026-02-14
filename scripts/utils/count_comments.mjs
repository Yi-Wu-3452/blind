
import fs from 'fs';

const filePath = process.argv[2];
if (!filePath) {
    console.log("Usage: node count_comments.mjs <json_file>");
    process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(content);

let totalComments = 0;
let userCounts = {};

function traverse(replies) {
    if (!replies) return;
    for (const r of replies) {
        totalComments++;
        const user = r.userName || "Unknown";
        userCounts[user] = (userCounts[user] || 0) + 1;
        traverse(r.nested);
    }
}

traverse(data.replies);

console.log(`File: ${filePath}`);
console.log(`Metadata commentsCount: ${data.commentsCount}`);
console.log(`Actual Scraped Count: ${totalComments}`);
console.log(`Difference: ${parseInt(data.commentsCount) - totalComments}`);
// console.log("User Frequency:", userCounts);
