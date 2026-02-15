import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];

if (!filePath) {
    console.error("Please provide a JSON file path.");
    process.exit(1);
}

try {
    const data = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));
    const ids = [];

    const collectIds = (items) => {
        if (!items || !Array.isArray(items)) return;
        items.forEach(item => {
            if (item.commentId) ids.push(item.commentId);
            if (item.nested) collectIds(item.nested);
        });
    };

    collectIds(data.replies);

    console.log(`\n🆔 Comment IDs in: ${path.basename(filePath)}`);
    console.log(`--------------------------------------------------`);
    ids.forEach((id, index) => {
        console.log(`${String(index + 1).padStart(3, ' ')}. ${id}`);
    });
    console.log(`--------------------------------------------------`);
    console.log(`Total IDs found: ${ids.length}\n`);

} catch (e) {
    console.error(`Error reading or parsing file: ${e.message}`);
}
