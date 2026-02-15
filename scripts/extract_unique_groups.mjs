import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];

if (!filePath) {
    console.error("Please provide a JSON file path.");
    process.exit(1);
}

try {
    const data = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));
    const groupIds = new Set();

    if (data.debug && data.debug.all_comment_ids) {
        data.debug.all_comment_ids.forEach(item => {
            if (item.commentGroupId) groupIds.add(item.commentGroupId);
        });
    } else {
        // Fallback to recursive traversal if debug info is missing
        const collectGroups = (items) => {
            if (!items || !Array.isArray(items)) return;
            items.forEach(item => {
                if (item.commentGroupId) groupIds.add(item.commentGroupId);
                if (item.nested) collectGroups(item.nested);
            });
        };
        collectGroups(data.replies);
    }

    const uniqueGroups = Array.from(groupIds).sort();

    console.log(`\n📂 Unique Comment Group IDs in: ${path.basename(filePath)}`);
    console.log(`--------------------------------------------------`);
    uniqueGroups.forEach((id, index) => {
        console.log(`${String(index + 1).padStart(3, ' ')}. ${id}`);
    });
    console.log(`--------------------------------------------------`);
    console.log(`Total unique groups: ${uniqueGroups.length}\n`);

} catch (e) {
    console.error(`Error reading or parsing file: ${e.message}`);
}
