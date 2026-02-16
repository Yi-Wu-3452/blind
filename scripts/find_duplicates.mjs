import fs from 'fs';

const jsonFile = process.argv[2];
if (!jsonFile) {
    console.error('Usage: node find_duplicates.mjs <path-to-json>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));

const allIds = [];
const idLocations = {};

function collectIds(comments, path = 'root') {
    for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        const id = comment.commentId;
        const location = `${path}[${i}]`;

        allIds.push(id);

        if (!idLocations[id]) {
            idLocations[id] = [];
        }
        idLocations[id].push({
            location,
            userName: comment.userName,
            content: comment.content?.substring(0, 50) + (comment.content?.length > 50 ? '...' : ''),
            nestedCount: comment.nestedCount
        });

        if (comment.nested && comment.nested.length > 0) {
            collectIds(comment.nested, `${location}.nested`);
        }
    }
}

collectIds(data.replies);

console.log(`Total comments scraped: ${allIds.length}`);
console.log(`Unique comment IDs: ${new Set(allIds).size}`);
console.log('');

const duplicates = Object.entries(idLocations).filter(([id, locations]) => locations.length > 1);

if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} duplicate comment ID(s):\n`);

    for (const [id, locations] of duplicates) {
        console.log(`━━━ ${id} (appears ${locations.length} times) ━━━`);
        locations.forEach((loc, idx) => {
            console.log(`  ${idx + 1}. Location: ${loc.location}`);
            console.log(`     User: ${loc.userName}`);
            console.log(`     Content: ${loc.content}`);
            console.log(`     Nested count: ${loc.nestedCount}`);
            console.log('');
        });
    }
} else {
    console.log('✅ No duplicate comment IDs found!');
}
