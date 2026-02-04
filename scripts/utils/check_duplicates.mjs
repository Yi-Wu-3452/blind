import fs from 'fs/promises';
import path from 'path';

async function checkDuplicates() {
    const filePath = path.resolve('nvidia_urls.txt');

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        const urlMap = new Map();
        const duplicates = [];

        lines.forEach((line, index) => {
            const url = line.trim();
            if (!url) return;

            if (urlMap.has(url)) {
                duplicates.push({
                    url,
                    originalLine: urlMap.get(url) + 1,
                    duplicateLine: index + 1
                });
            } else {
                urlMap.set(url, index);
            }
        });

        console.log(`Total URLs processed: ${lines.filter(l => l.trim()).length}`);
        console.log(`Unique URLs: ${urlMap.size}`);

        if (duplicates.length > 0) {
            console.log(`\nFound ${duplicates.length} duplicate(s):`);
            duplicates.forEach(dup => {
                console.log(`- Duplicate found at line ${dup.duplicateLine} (Original at line ${dup.originalLine}): ${dup.url}`);
            });
        } else {
            console.log('\nNo duplicates found.');
        }

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`Error: File not found at ${filePath}`);
        } else {
            console.error(`An error occurred: ${error.message}`);
        }
    }
}

checkDuplicates();
