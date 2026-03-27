import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = path.resolve(__dirname, "../company_list_over_10k.json");
const OUTPUT_PATH = path.resolve(__dirname, "../company_list_over_10k_with_tags.json");

async function extractTags() {
    console.log("Reading company list...");
    const companies = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    console.log(`Found ${companies.length} companies.`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    const results = [];

    for (const company of companies) {
        console.log(`Processing ${company["Company Name"]} (${company.Symbol})...`);
        const url = company["Post URL"];
        const companySlug = url.split('/').filter(p => !!p).slice(-2, -1)[0];

        try {
            console.log(`  Navigating to ${url}...`);
            await page.goto(url, { waitUntil: 'load', timeout: 60000 });

            // Wait for any initial loading states to clear
            await page.waitForTimeout(3000);

            // Wait for the tag container to appear
            let containerFound = false;
            try {
                await page.waitForSelector('div.flex.flex-wrap.gap-1', { timeout: 20000 });
                containerFound = true;
            } catch (e) {
                console.log(`  Warning: Tag container not found for ${company.Symbol}.`);
            }

            if (containerFound) {
                // Extract tags
                const tags = await page.evaluate((slug) => {
                    const container = document.querySelector('div.flex.flex-wrap.gap-1');
                    if (!container) return [];

                    return Array.from(container.querySelectorAll('button, a'))
                        .map(el => {
                            const name = el.innerText.trim();
                            if (!name || name === 'All' || name.includes('Search by')) return null;

                            const tagSlug = name.toLowerCase()
                                .replace(/ /g, '-')
                                .replace(/[^a-z0-9\-]/g, '')
                                .replace(/-+/g, '-');

                            const urlSlug = `${slug.toLowerCase()}-${tagSlug}`;

                            return {
                                Name: name,
                                URL: `${window.location.origin}/company/${slug}/posts/${urlSlug}`
                            };
                        })
                        .filter(t => t !== null && t.Name.length > 0);
                }, companySlug);

                console.log(`  Found ${tags.length} tags.`);
                results.push({
                    ...company,
                    Tags: tags
                });
            } else {
                results.push({
                    ...company,
                    Tags: [],
                    Error: "Tag container not found"
                });
            }

            // Longer delay between companies
            await page.waitForTimeout(3000 + Math.random() * 3000);

        } catch (error) {
            console.error(`  Error processing ${company["Company Name"]}:`, error.message);
            results.push({
                ...company,
                Tags: [],
                Error: error.message
            });

            if (error.message.includes('Target page, context or browser has been closed')) {
                console.log("  🛑 Browser connection lost. Re-initializing...");
                // We could potentially re-launch here if needed
                break;
            }
        }
    }

    try {
        await browser.close();
    } catch (e) { }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    console.log(`Successfully saved results to ${OUTPUT_PATH}`);
}

extractTags().catch(e => {
    console.error("Critical error in extractTags script:", e);
    process.exit(1);
});
