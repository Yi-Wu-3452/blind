import fs from 'fs';
import path from 'path';

const filePath = '/Users/ywu47/Documents/blind/data/posts_greedy/is-nvidia-really-fcked-like-everyone-says-uakgdxh7.json';

function countReplies(replies) {
    let count = 0;
    if (!replies || !Array.isArray(replies)) return 0;

    for (const reply of replies) {
        count++; // count this reply
        if (reply.nested && reply.nested.length > 0) {
            count += countReplies(reply.nested);
        }
    }
    return count;
}

try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const topLevelCount = data.replies ? data.replies.length : 0;
    const totalCount = countReplies(data.replies);

    console.log(`JSON File: ${path.basename(filePath)}`);
    console.log(`Top-level replies: ${topLevelCount}`);
    console.log(`Total replies (including nested): ${totalCount}`);
    console.log(`Metadata commentsCount: ${data.commentsCount}`);
} catch (error) {
    console.error('Error reading or parsing JSON file:', error);
}
