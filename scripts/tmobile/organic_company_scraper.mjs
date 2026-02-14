
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, downloadAllImages, dismissBlockers } from "../core/extract_post_details_optimized.mjs";

// Apply stealth plugin
chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_OUT_DIR = path.resolve(__dirname, "../../data/organic_scrapes");

const SHOULD_LOGIN = false; // User requested no login

async function startOrganicScraping() {
    const COMPANY_NAME = process.argv[2] || "T-Mobile";
    const START_PAGE = parseInt(process.argv[3] || "1", 10);
    const MAX_PAGES = process.argv[4] ? parseInt(process.argv[4], 10) : 100;

    console.log(`⚡ Starting ORGANIC company scraper for: ${COMPANY_NAME}`);
    console.log(`⚡ Range: Page ${START_PAGE} to ${START_PAGE + MAX_PAGES - 1}`);
    console.log(`⚡ Mode: Guest (Stealth Enabled, No Login, Headless)`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // No login needed as SHOULD_LOGIN is false

    for (let p = START_PAGE; p < START_PAGE + MAX_PAGES; p++) {
        const listUrl = `https://www.teamblind.com/company/${COMPANY_NAME}/posts?page=${p}`;
        console.log(`\n📄 --- Scrutinizing Page ${p} ---`);

        try {
            await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            const status = await dismissBlockers(page);
            if (status === "rate_limited") {
                console.log("🛑 Rate limited on list page. Cooling down...");
                await page.waitForTimeout(300000); // 5 min
                p--; continue;
            }

            // Scroll to trigger lazy load if needed
            await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
            await page.waitForTimeout(1000);

            const postLinks = await page.$$eval('article a.block.h-full', els => els.map(el => el.href));
            console.log(`🔍 Found ${postLinks.length} posts on page ${p}`);

            const pageDir = path.join(BASE_OUT_DIR, COMPANY_NAME, `page_${p}`);
            if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

            for (const postUrl of postLinks) {
                const slug = postUrl.split('/').pop();
                const filePath = path.join(pageDir, `${slug}.json`);

                if (fs.existsSync(filePath)) {
                    console.log(`⏭️ Skipping (already exists): ${slug}`);
                    continue;
                }

                console.log(`👉 Opening in new tab: ${slug}`);

                // Initialize per-post logger
                const logsDir = path.join(pageDir, "logs");
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }
                const logFile = path.join(logsDir, `${slug}.log`);
                const logger = {
                    log: (...args) => {
                        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                        const timestamp = new Date().toISOString();
                        const line = `[${timestamp}] ${message}\n`;
                        console.log(message); // Still log to stdout
                        try {
                            fs.appendFileSync(logFile, line);
                        } catch (e) { /* Ignore log write errors */ }
                    },
                    error: (...args) => {
                        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                        const timestamp = new Date().toISOString();
                        const line = `[${timestamp}] ERROR: ${message}\n`;
                        console.error(message);
                        try {
                            fs.appendFileSync(logFile, line);
                        } catch (e) { /* Ignore log write errors */ }
                    }
                };

                let retry = 0;
                let success = false;
                while (retry < 3 && !success) {
                    const postPage = await context.newPage();
                    try {
                        // Navigate to post with Referer header
                        await postPage.goto(postUrl, {
                            waitUntil: "domcontentloaded", // Faster
                            timeout: 60000,
                            referer: listUrl
                        });

                        const data = await extractPostData(postPage, postUrl, logger);
                        await downloadAllImages(data, postUrl, logger);
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                        logger.log(`✅ Saved: ${filePath} (${data.replies.length} comments)`);
                        success = true;
                    } catch (e) {
                        retry++;
                        if (e.message === "RATE_LIMITED") {
                            logger.log(`⚠️ Rate limit hit. Cooling down 5m...`);
                            await postPage.close();
                            await page.waitForTimeout(300000); // Wait on main page
                        } else {
                            logger.log(`❌ Error: ${e.message}. Retrying...`);
                        }
                    } finally {
                        if (postPage && !postPage.isClosed()) await postPage.close();
                    }
                }
                if (!success) console.error(`❌ Failed to scrape: ${postUrl}`);

                // Adaptive human delay between posts
                const delay = 3000 + Math.random() * 5000;
                await page.waitForTimeout(delay);
            }
        } catch (e) {
            console.error(`❌ Global error on page ${p}: ${e.message}`);
        }
    }
    await browser.close();
    console.log("\n✅ Organic scraping session completed.");
}

startOrganicScraping().catch(console.error);
