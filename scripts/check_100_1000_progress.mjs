import fs from 'fs';
import path from 'path';

const companyListPath = 'company_list_100_to_1000.json';
const dataDir = 'data/company_post_urls';

function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
}

if (!fs.existsSync(companyListPath)) {
    console.error(`File not found: ${companyListPath}`);
    process.exit(1);
}

const companies = JSON.parse(fs.readFileSync(companyListPath, 'utf8'));
let totalPostsExpected = 0;
let totalPostsScraped = 0;
let fullyScraped = 0;
let partiallyScraped = 0;
let notScraped = 0;

const results = [];

companies.forEach(company => {
    const dirName = normalize(company['Company Name']);
    const companyDir = path.join(dataDir, dirName);
    const postsDir = path.join(companyDir, 'posts');

    const expected = company['# Posts'] || 0;
    totalPostsExpected += expected;

    let scraped = 0;
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
        scraped = files.length;
    }

    totalPostsScraped += scraped;

    if (scraped >= expected && expected > 0) {
        fullyScraped++;
    } else if (scraped > 0) {
        partiallyScraped++;
    } else {
        notScraped++;
    }

    results.push({
        name: company['Company Name'],
        expected,
        scraped,
        status: scraped >= expected ? '✅' : (scraped > 0 ? '🕒' : '❌')
    });
});

console.log(`Summary for ${companyListPath}:`);
console.log(`Total Companies: ${companies.length}`);
console.log(`Fully Scraped: ${fullyScraped}`);
console.log(`Partially Scraped: ${partiallyScraped}`);
console.log(`Not Scraped: ${notScraped}`);
console.log(`Total Posts Expected: ${totalPostsExpected}`);
console.log(`Total Posts Scraped: ${totalPostsScraped}`);
console.log(`Overall Completion: ${((totalPostsScraped / totalPostsExpected) * 100).toFixed(2)}%`);

if (notScraped > 0 || partiallyScraped > 0) {
    console.log('\nDetails for Incomplete/Missing:');
    results.filter(r => r.scraped < r.expected).forEach(r => {
        console.log(`${r.status} ${r.name}: ${r.scraped}/${r.expected}`);
    });
}
