import fs from 'fs';
import path from 'path';

const companyListPath = 'company_list_under_100.json';
const dataDir = 'data/company_post_urls';

function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
}

const companies = JSON.parse(fs.readFileSync(companyListPath, 'utf8'));
let found = 0;
let missingDetailed = [];

companies.forEach(company => {
    const dirName = normalize(company['Company Name']);
    const companyDir = path.join(dataDir, dirName);
    const postsDir = path.join(companyDir, 'posts');

    let hasPosts = false;
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
            hasPosts = true;
        }
    }

    if (hasPosts) {
        found++;
    } else {
        missingDetailed.push({
            name: company['Company Name'],
            dirName: dirName,
            dirExists: fs.existsSync(companyDir),
            contents: fs.existsSync(companyDir) ? fs.readdirSync(companyDir) : []
        });
    }
});

console.log(`Total companies in list: ${companies.length}`);
console.log(`Companies with scraped posts: ${found}`);
console.log(`Companies missing: ${missingDetailed.length}`);

if (missingDetailed.length > 0) {
    console.log('\nMissing Companies Detail:');
    missingDetailed.forEach(m => {
        console.log(`- ${m.name} (${m.dirName}): DirExists=${m.dirExists}, Contents=[${m.contents.join(', ')}]`);
    });
}
