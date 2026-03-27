import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to normalize company names (same as in other scripts)
const normalize = (name) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
};

async function zipCompanyData(companyName, dataDir) {
    const dirName = normalize(companyName);
    const companyDir = path.join(dataDir, dirName);
    const aggregatedFile = path.join(companyDir, 'aggregated_posts.json');
    const imagesDir = path.resolve(__dirname, "../../data/company_posts", dirName, "images");
    const discrepancyReport = path.join(companyDir, 'discrepancy_report.md');
    const zipFilePath = path.join(companyDir, `${dirName}_data.zip`);

    if (!fs.existsSync(aggregatedFile)) {
        console.log(`[${companyName}] Skipping: aggregated_posts.json not found.`);
        return false;
    }

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`[${companyName}] Zip created: ${zipFilePath} (${archive.pointer()} total bytes)`);
            resolve(true);
        });

        archive.on('error', (err) => {
            console.error(`[${companyName}] Error zipping: ${err.message}`);
            reject(err);
        });

        archive.pipe(output);
        archive.file(aggregatedFile, { name: 'aggregated_posts.json' });
        if (fs.existsSync(imagesDir)) {
            archive.directory(imagesDir, 'images');
        }
        if (fs.existsSync(discrepancyReport)) {
            archive.file(discrepancyReport, { name: 'discrepancy_report.md' });
        }
        archive.finalize();
    });
}

async function createMasterZip(companies, dataDir, outputZipPath) {
    console.log(`Creating master zip: ${outputZipPath}...`);

    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const result = new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log(`Master zip created: ${outputZipPath} (${archive.pointer()} total bytes)`);
            resolve(true);
        });
        archive.on('error', reject);
    });

    archive.pipe(output);

    let addedCount = 0;
    let missingCompanies = [];

    for (const company of companies) {
        const companyName = company['Company Name'];
        const dirName = normalize(companyName);
        const companyDir = path.join(dataDir, dirName);
        const aggregatedFile = path.join(companyDir, 'aggregated_posts.json');
        const imagesDir = path.resolve(__dirname, "../../data/company_posts", dirName, "images");
        const discrepancyReport = path.join(companyDir, 'discrepancy_report.md');

        if (fs.existsSync(aggregatedFile)) {
            // Add company directory structure within zip
            archive.file(aggregatedFile, { name: `${dirName}/aggregated_posts.json` });
            if (fs.existsSync(imagesDir)) {
                archive.directory(imagesDir, `${dirName}/images`);
            }
            if (fs.existsSync(discrepancyReport)) {
                archive.file(discrepancyReport, { name: `${dirName}/discrepancy_report.md` });
            }
            addedCount++;
            if (addedCount % 10 === 0) {
                process.stdout.write(`.`);
            }
        } else {
            missingCompanies.push({
                name: companyName,
                dirName: dirName
            });
        }
    }

    // Add the companies without posts list to the root of the zip
    const missingJson = JSON.stringify(missingCompanies, null, 2);
    archive.append(missingJson, { name: 'companies_without_posts.json' });

    console.log(`\nAdded ${addedCount} companies to master zip.`);
    console.log(`Added companies_without_posts.json with ${missingCompanies.length} entries.`);
    archive.finalize();

    return result;
}

async function main() {
    const args = process.argv.slice(2);
    const companyListArg = args.find(arg => arg.startsWith('--company-list='));
    const companyNameArg = args.find(arg => arg.startsWith('--company='));
    const masterArg = args.includes('--master');
    const outputArg = args.find(arg => arg.startsWith('--output='));

    const companyListPath = companyListArg ? companyListArg.split('=')[1] : 'company_list_under_100.json';
    const dataDir = path.join(process.cwd(), 'data', 'company_post_urls');

    if (companyNameArg) {
        const companyName = companyNameArg.split('=')[1];
        await zipCompanyData(companyName, dataDir);
    } else if (fs.existsSync(companyListPath)) {
        const companies = JSON.parse(fs.readFileSync(companyListPath, 'utf8'));

        if (masterArg) {
            const outputZipPath = outputArg ? outputArg.split('=')[1] : path.join(process.cwd(), 'data', 'posts_company_under100.zip');
            await createMasterZip(companies, dataDir, outputZipPath);
        } else {
            let zipsCreated = 0;
            for (const company of companies) {
                try {
                    const success = await zipCompanyData(company['Company Name'], dataDir);
                    if (success) zipsCreated++;
                } catch (err) { }
            }
            console.log(`\nZipping Summary:`);
            console.log(`- Zips created: ${zipsCreated}`);
        }
    } else {
        console.error(`Error: Company list file not found at ${companyListPath}`);
        console.log(`Usage: node zip_company_data.mjs [--company-list=list.json] [--company="Name"] [--master] [--output=path.zip]`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
