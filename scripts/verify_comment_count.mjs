import fs from 'fs';
import path from 'path';

/**
 * Recursively counts replies and their nested replies.
 * @param {Array} replies Array of reply objects.
 * @returns {number} The total count of replies in this subtree.
 */
function countReplies(replies) {
    if (!replies || !Array.isArray(replies)) {
        return 0;
    }

    let count = 0;
    for (const reply of replies) {
        count += 1; // Count the current reply
        if (reply.nested && reply.nested.length > 0) {
            count += countReplies(reply.nested); // Recursively count nested replies
        }
    }
    return count;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: node scripts/verify_comment_count.mjs <path-to-json-file>');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        process.exit(1);
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(data);

        const expectedCount = parseInt(json.commentsCount, 10) || 0;
        const actualCount = countReplies(json.replies);

        console.log(`\nVerifying post: ${json.title || 'Untitled'}`);
        console.log(`URL: ${json.url}`);
        console.log('-------------------------------------------');
        console.log(`Count in "commentsCount" field: ${expectedCount}`);
        console.log(`Actual counted replies:        ${actualCount}`);

        if (expectedCount === actualCount) {
            console.log('\n✅ VERIFICATION SUCCESS: Comment counts match!');
        } else {
            const diff = actualCount - expectedCount;
            console.log(`\n❌ VERIFICATION FAILURE: Comment counts mismatch!`);
            console.log(`Difference: ${diff > 0 ? '+' : ''}${diff} comments`);
        }
        console.log('-------------------------------------------\n');

    } catch (error) {
        console.error(`Error processing file: ${error.message}`);
        process.exit(1);
    }
}

main();
