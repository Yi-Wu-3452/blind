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

let totalExpectedComments = 0;
let totalScrapedComments = 0;
let totalPostsProcessed = 0;
let postsWithMismatches = 0;

const companyStats = [];

companies.forEach(company => {
    const dirName = normalize(company['Company Name']);
    const postsDir = path.join(dataDir, dirName, 'posts');

    let companyExpected = 0;
    let companyScraped = 0;
    let companyPosts = 0;
    let companyMismatches = 0;

    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
        files.forEach(file => {
            try {
                const postData = JSON.parse(fs.readFileSync(path.join(postsDir, file), 'utf8'));
                const expected = parseInt(postData.commentsCount || 0, 10);
                const scraped = postData.scrapedCommentsCount || 0;

                companyExpected += expected;
                companyScraped += scraped;
                companyPosts++;

                if (scraped < expected) {
                    companyMismatches++;
                }
            } catch (e) {
                // Skip malformed files
            }
        });
    }

    if (companyPosts > 0) {
        totalExpectedComments += companyExpected;
        totalScrapedComments += companyScraped;
        totalPostsProcessed += companyPosts;
        postsWithMismatches += companyMismatches;

        companyStats.push({
            name: company['Company Name'],
            posts: companyPosts,
            expected: companyExpected,
            scraped: companyScraped,
            mismatches: companyMismatches,
            completeness: companyExpected > 0 ? (companyScraped / companyExpected * 100).toFixed(2) : "100.00"
        });
    }
});

console.log(`Comment Completeness Summary:`);
console.log(`Total Posts Processed: ${totalPostsProcessed}`);
console.log(`Total Expected Comments: ${totalExpectedComments}`);
console.log(`Total Scraped Comments: ${totalScrapedComments}`);
console.log(`Overall Comment Completeness: ${((totalScrapedComments / totalExpectedComments) * 100).toFixed(2)}%`);
console.log(`Posts with missing comments: ${postsWithMismatches} (${(postsWithMismatches / totalPostsProcessed * 100).toFixed(2)}%)`);

console.log('\nTop 10 Companies by Missing Comments (Percentage):');
const topMissing = companyStats
    .filter(s => s.expected > s.scraped)
    .sort((a, b) => parseFloat(a.completeness) - parseFloat(b.completeness))
    .slice(0, 10);

topMissing.forEach(s => {
    console.log(`- ${s.name}: ${s.completeness}% (Scraped: ${s.scraped}/${s.expected}, Posts: ${s.posts}, Incomplete Posts: ${s.mismatches})`);
});

const dgStats = companyStats.find(s => s.name === 'Dollar General');
if (dgStats && dgStats.mismatches > 0) {
    console.log('\nIncomplete Posts for Dollar General:');
    const dirName = normalize('Dollar General');
    const postsDir = path.join(dataDir, dirName, 'posts');
    const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
    let printed = 0;
    files.forEach(file => {
        if (printed >= 20) return;
        try {
            const postData = JSON.parse(fs.readFileSync(path.join(postsDir, file), 'utf8'));
            const expected = parseInt(postData.commentsCount || 0, 10);
            const scraped = postData.scrapedCommentsCount || 0;
            if (scraped < expected) {
                console.log(`- ${file}: ${scraped}/${expected}`);
                printed++;
            }
        } catch (e) { }
    });
}
