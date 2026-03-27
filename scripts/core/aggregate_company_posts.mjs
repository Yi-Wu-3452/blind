import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to normalize company names (same as in other scripts)
const normalize = (name) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
};

async function aggregateCompany(companyName, dataDir) {
    const dirName = normalize(companyName);
    const companyDir = path.join(dataDir, dirName);
    const postsDir = path.resolve(__dirname, "../../data/company_posts", dirName);
    const outputFile = path.join(companyDir, 'aggregated_posts.json');

    if (!fs.existsSync(postsDir)) {
        console.log(`[${companyName}] Skipping: posts directory not found.`);
        return 0;
    }

    const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log(`[${companyName}] Skipping: No JSON files in posts directory.`);
        return 0;
    }

    console.log(`[${companyName}] Aggregating ${files.length} posts...`);
    const aggregated = [];

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(postsDir, file), 'utf8');
            const post = JSON.parse(content);
            aggregated.push(post);
        } catch (err) {
            console.error(`[${companyName}] Error reading ${file}: ${err.message}`);
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(aggregated, null, 2));
    console.log(`[${companyName}] Saved to ${outputFile}`);
    return aggregated.length;
}

async function main() {
    const args = process.argv.slice(2);
    const companyListArg = args.find(arg => arg.startsWith('--company-list='));
    const companyNameArg = args.find(arg => arg.startsWith('--company='));

    const companyListPath = companyListArg ? companyListArg.split('=')[1] : 'company_list_under_100.json';
    const dataDir = path.join(process.cwd(), 'data', 'company_post_urls');

    if (companyNameArg) {
        const companyName = companyNameArg.split('=')[1];
        await aggregateCompany(companyName, dataDir);
    } else if (fs.existsSync(companyListPath)) {
        const companies = JSON.parse(fs.readFileSync(companyListPath, 'utf8'));
        let totalAggregated = 0;
        let companiesProcessed = 0;

        for (const company of companies) {
            const count = await aggregateCompany(company['Company Name'], dataDir);
            if (count > 0) {
                totalAggregated += count;
                companiesProcessed++;
            }
        }

        console.log(`\nAggregation Summary:`);
        console.log(`- Companies processed: ${companiesProcessed}`);
        console.log(`- Total posts aggregated: ${totalAggregated}`);
    } else {
        console.error(`Error: Company list file not found at ${companyListPath}`);
        console.log(`Usage: node aggregate_company_posts.mjs [--company-list=path/to/list.json] [--company="Company Name"]`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
