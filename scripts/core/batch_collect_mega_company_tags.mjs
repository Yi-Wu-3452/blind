import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { collectUrlsForCompany, login } from "./collect_company_urls_robust.mjs";
import { setActiveLogFile } from "./logger.mjs";

// chromium.use(stealth()); // Disabled by default as per user request

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");
const DATA_DIR = path.resolve(ROOT_DIR, "data");
const BASE_OUT_DIR = path.resolve(DATA_DIR, "company_post_urls");
const TAGS_LIST_PATH = path.resolve(ROOT_DIR, "company_list_over_10k_with_tags.json");

// Parse CLI args
const args = process.argv.slice(2);
const targetCompany = args.find(arg => arg.startsWith("--company="))?.split("=")[1];
const targetTags = args.find(arg => arg.startsWith("--tags="))?.split("=")[1]?.split(",").map(t => t.trim().toLowerCase());
const limit = parseInt(args.find(arg => arg.startsWith("--limit="))?.split("=")[1] || "1000");
const force = args.includes("--force");
const isHeadless = args.includes("--headless");
const useStealth = args.includes("--stealth");

if (useStealth) {
    console.log("🕵️ Stealth mode enabled.");
    chromium.use(stealth());
}

async function runBatchTags() {
    if (!fs.existsSync(TAGS_LIST_PATH)) {
        console.error(`❌ Error: company_list_over_10k_with_tags.json not found at ${TAGS_LIST_PATH}`);
        return;
    }

    let companies = JSON.parse(fs.readFileSync(TAGS_LIST_PATH, "utf-8"));

    if (targetCompany) {
        companies = companies.filter(c =>
            c["Company Name"].toLowerCase() === targetCompany.toLowerCase() ||
            c.Symbol.toLowerCase() === targetCompany.toLowerCase()
        );
    }

    if (companies.length === 0) {
        console.error(`❌ No companies found matching "${targetCompany}"`);
        return;
    }

    console.log(`📋 Processing tags for ${companies.length} companies.`);

    const browser = await chromium.launch({
        headless: isHeadless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1280,800',
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    if (args.includes("--login") || args.includes("--auto-login")) {
        console.log("🔑 Logging in...");
        await login(page, { automatic: true });
    }

    for (const company of companies) {
        const companyName = company["Company Name"];
        const safeName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
        const companyDir = path.join(BASE_OUT_DIR, safeName);
        const tagsDir = path.join(companyDir, "tags");

        if (!fs.existsSync(tagsDir)) fs.mkdirSync(tagsDir, { recursive: true });

        console.log(`\n🏢 Processing Company: ${companyName}`);

        let tags = company.Tags || [];
        if (targetTags && targetTags.length > 0) {
            tags = tags.filter(t => targetTags.includes(t.Name.toLowerCase()));
        }
        console.log(`🏷️ Found ${tags.length} tags to process.`);

        for (const tag of tags) {
            const tagSafeName = tag.Name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");

            const runs = [
                { sort: "recent", suffix: "_recent" },
                { sort: "top", suffix: "_top" }
            ];

            for (const run of runs) {
                const outFile = path.join(tagsDir, `${tagSafeName}${run.suffix}.json`);

                if (fs.existsSync(outFile) && !force) {
                    console.log(`⏭️  Skipping Tag: ${tag.Name} (${run.sort}) - already exists.`);
                    continue;
                }

                console.log(`▶️  Tag: ${tag.Name} (${run.sort})`);

                let targetUrl = tag.URL;
                if (run.sort === "top") {
                    targetUrl += targetUrl.includes("?") ? `&sort=${run.sort}` : `?sort=${run.sort}`;
                }

                // Set active log file
                setActiveLogFile(path.join(tagsDir, `log_${tagSafeName}${run.suffix}.txt`));

                try {
                    await collectUrlsForCompany(page, {
                        targetUrl,
                        outFile,
                        scrollCount: 2, // Fewer scrolls per tag to be faster
                        useRobustScroll: true,
                        patienceLimit: 3
                    });
                } catch (error) {
                    console.error(`   ❌ Failed tag ${tag.Name} (${run.sort}): ${error.message}`);
                }

                // Tag-level cooldown
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            }
        }

        // Merge logic
        console.log(`\n🔄 Merging tags for ${companyName}...`);
        const allUrls = new Map();
        const tagFiles = fs.readdirSync(tagsDir).filter(f => f.endsWith(".json") && !f.includes("_merged"));

        for (const file of tagFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(tagsDir, file), "utf-8"));
                data.forEach(item => {
                    if (item.url) {
                        if (!allUrls.has(item.url)) {
                            allUrls.set(item.url, {
                                ...item,
                                tags: [file.replace(".json", "")]
                            });
                        } else {
                            allUrls.get(item.url).tags.push(file.replace(".json", ""));
                        }
                    }
                });
            } catch (e) {
                console.error(`Error reading ${file}: ${e.message}`);
            }
        }

        const mergedFile = path.join(companyDir, `${safeName}_tags_merged.json`);
        const mergedData = Array.from(allUrls.values());
        fs.writeFileSync(mergedFile, JSON.stringify(mergedData, null, 2));
        console.log(`✅ Merged ${mergedData.length} unique URLs into ${mergedFile}`);
    }

    await context.close();
    await browser.close();
}

runBatchTags().catch(async (err) => {
    console.error(`\n❌ Fatal error:`, err);
    process.exit(1);
});
