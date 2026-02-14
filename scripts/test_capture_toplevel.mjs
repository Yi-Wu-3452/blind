import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, dismissBlockers, downloadAllImages } from "./core/extract_post_details_optimized.mjs";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const URL = "https://www.teamblind.com/post/looking-for-referrals-support-roles-72zi5ona";
const URL = "https://www.teamblind.com/post/referral-india-hdf3n6yc";
const OUT_DIR = path.resolve(__dirname, "../data/test_output");
const LOG_DIR = path.resolve(OUT_DIR, "logs");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const slug = URL.split("/").pop();
const logFile = path.join(LOG_DIR, `${slug}.log`);

// Clear previous log
fs.writeFileSync(logFile, "");

const logger = {
    log: (...args) => {
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${message}\n`;
        process.stdout.write(line);
        try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
    },
    error: (...args) => {
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ERROR: ${message}\n`;
        process.stderr.write(line);
        try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
    }
};

(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
        await page.goto(URL, { waitUntil: "domcontentloaded", referer: "https://www.teamblind.com/" });

        const data = await extractPostData(page, URL, logger, { captureTopLevel: true });

        const filePath = path.join(OUT_DIR, `${slug}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        logger.log(`✅ Saved: ${filePath}`);
        logger.log(`   Top-level comments: ${data.replies.length}`);
        logger.log(`   Scraped count: ${data.scrapedCommentsCount}`);
        logger.log(`   Metadata count: ${data.commentsCount}`);
    } catch (e) {
        logger.error(`Error: ${e.message}`);
    } finally {
        await browser.close();
    }
})();
