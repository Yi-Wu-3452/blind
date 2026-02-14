
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, downloadAllImages, dismissBlockers, login } from "../core/extract_post_details_optimized.mjs";

// Apply stealth plugin
chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_OUT_DIR = path.resolve(__dirname, "../../data/organic_scrapes");

// Credentials are handled in extract_post_details_optimized.mjs (via CREDENTIALS const there, or environment)
// But wait, extract_post_details_optimized has local CREDENTIALS. 
// We will assume the imported login function uses its internal consts.

const SHOULD_LOGIN = true;
const MAX_CONCURRENT_WORKERS = 2; // Reduced for stability

// Shared State
const sharedState = {
    isRateLimited: false,
    backoffEndTime: 0,
    processedPosts: new Set(),
    totalSaved: 0,
    pagesToScrape: []
};

function getFormattedScrapeTime() {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
}

async function runWorker(workerId, context, companyName) {
    console.log(`[Worker ${workerId}] Started.`);
    const page = await context.newPage();

    while (sharedState.pagesToScrape.length > 0) {
        // Handle global backoff
        if (sharedState.isRateLimited) {
            const waitTime = Math.max(0, sharedState.backoffEndTime - Date.now());
            if (waitTime > 0) {
                console.log(`[Worker ${workerId}] Global backoff in progress. Waiting ${Math.ceil(waitTime / 1000)}s...`);
                await new Promise(r => setTimeout(r, 5000));
                continue;
            } else {
                sharedState.isRateLimited = false;
            }
        }

        const p = sharedState.pagesToScrape.shift();
        if (p === undefined) break;

        const listUrl = `https://www.teamblind.com/company/${companyName}/posts?page=${p}`;
        console.log(`[Worker ${workerId}] Scrutinizing Page ${p}...`);

        try {
            await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForTimeout(2000); // Wait for potential blockers

            const status = await dismissBlockers(page);
            if (status === "rate_limited") {
                console.log(`[Worker ${workerId}] ⚠️ Possible rate limit on list page ${p}. Pausing 30s and retrying...`);
                await page.waitForTimeout(30000);
                await page.reload({ waitUntil: "domcontentloaded" });
                const statusRetry = await dismissBlockers(page);
                if (statusRetry === "rate_limited") {
                    console.log(`[Worker ${workerId}] 🛑 Confirmed rate limit on list page ${p}. Triggering global backoff.`);
                    sharedState.isRateLimited = true;
                    sharedState.backoffEndTime = Date.now() + 300000; // 5 min
                    sharedState.pagesToScrape.unshift(p); // Re-queue
                    continue;
                }
            }

            // Scroll to trigger lazy load
            await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
            await page.waitForTimeout(1000);

            let postLinks = [];
            try {
                postLinks = await page.$$eval('article a.block.h-full', els => els.map(el => el.href));
            } catch (e) {
                console.log(`[Worker ${workerId}] ⚠️ Failed to extract links on page ${p} (Selectors changed? or Blocked?).`);
            }

            if (postLinks.length === 0) {
                console.log(`[Worker ${workerId}] ⚠️ No posts found on page ${p}.`);
            }

            const pageDir = path.join(BASE_OUT_DIR, companyName, `page_${p}`);
            if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

            for (const postUrl of postLinks) {
                const slug = postUrl.split('/').pop();
                const filePath = path.join(pageDir, `${slug}.json`);

                if (fs.existsSync(filePath)) continue;

                let success = false;
                let retry = 0;
                while (retry < 2 && !success) {
                    const postPage = await context.newPage();
                    try {
                        await postPage.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 60000, referer: listUrl });
                        const data = await extractPostData(postPage, postUrl); // Uses centralized logic
                        await downloadAllImages(data, postUrl); // Uses centralized logic
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                        sharedState.totalSaved++;
                        console.log(`[Worker ${workerId}] ✅ Saved: ${slug} (Total: ${sharedState.totalSaved}, Comments: ${data.replies.length})`);
                        success = true;
                    } catch (e) {
                        retry++;
                        if (e.message === "RATE_LIMITED") {
                            console.log(`[Worker ${workerId}] ⚠️ Rate limited on post ${slug}. Global backoff.`);
                            sharedState.isRateLimited = true;
                            sharedState.backoffEndTime = Date.now() + 300000;
                            break;
                        } else {
                            console.error(`[Worker ${workerId}] ❌ Error on ${slug}: ${e.message}`);
                        }
                    } finally {
                        if (postPage && !postPage.isClosed()) await postPage.close();
                    }
                    if (sharedState.isRateLimited) break;
                }
                if (sharedState.isRateLimited) break;

                // Human reading pause: 5s to 12s (Optimized for speed/safety balance)
                const pause = 5000 + Math.random() * 7000;
                // console.log(`[Worker ${workerId}] Pausing for ${Math.round(pause / 1000)}s...`);
                await new Promise(r => setTimeout(r, pause));
            }
        } catch (e) {
            console.error(`[Worker ${workerId}] ❌ Major error on Page ${p}: ${e.message}`);
            // If major navigation error, maybe re-queue
            if (e.message.includes('Timeout') || e.message.includes('Target closed')) {
                sharedState.pagesToScrape.push(p);
            }
        }
    }

    // Do not close context here, it is shared.
    console.log(`[Worker ${workerId}] Finished.`);
}

async function startParallelScraping() {
    const COMPANY_NAME = process.argv[2] || "T-Mobile";
    const START_PAGE = parseInt(process.argv[3] || "1", 10);
    const MAX_PAGES = process.argv[4] ? parseInt(process.argv[4], 10) : 100;
    const WORKER_COUNT = process.argv[5] ? parseInt(process.argv[5], 10) : MAX_CONCURRENT_WORKERS;

    console.log(`🚀 Starting PARALLEL organic scraper for: ${COMPANY_NAME}`);
    console.log(`🚀 Workers: ${WORKER_COUNT} | Range: Page ${START_PAGE} to ${START_PAGE + MAX_PAGES - 1}`);
    console.log(`🚀 Mode: Persistent + Stealth (Centralized Logic)`);

    // Populate queue
    for (let i = START_PAGE; i < START_PAGE + MAX_PAGES; i++) {
        sharedState.pagesToScrape.push(i);
    }

    // Use persistent context to save cookies/session
    const userDataDir = path.resolve(__dirname, "../../browser_profile");
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`Using persistent browser profile at: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome', // Force using installed Google Chrome
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--window-size=1920,1080',
            '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"'
        ],
        viewport: { width: 1920, height: 1080 }
    });

    // Login once (if needed)
    if (SHOULD_LOGIN) {
        const pages = context.pages();
        const loginPage = pages.length > 0 ? pages[0] : await context.newPage();
        await login(loginPage); // Uses centralized login with manual fallback!
        // Keep the login page open as a "tab anchor"
    }

    // Launch workers
    const workers = [];
    for (let i = 1; i <= WORKER_COUNT; i++) {
        workers.push(runWorker(i, context, COMPANY_NAME));
        // Stagger starts
        await new Promise(r => setTimeout(r, 5000));
    }

    await Promise.all(workers);
    // await context.close(); // Don't close persistent context automatically? existing script did.
    // Actually typically we want to close it to flush cookies to disk.

    console.log("\n✅ Parallel organic scraping session completed.");
    process.exit(0);
}

startParallelScraping().catch(console.error);
