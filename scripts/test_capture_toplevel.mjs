import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, dismissBlockers, downloadAllImages } from "./core/extract_post_details_optimized.mjs";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = "https://www.teamblind.com/post/6-yoe-swe-looking-for-referrals-mt3f2xu0";
const OUT_DIR = path.resolve(__dirname, "../data/test_output");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
        await page.goto(URL, { waitUntil: "domcontentloaded", referer: "https://www.teamblind.com/" });

        const data = await extractPostData(page, URL, console, { captureTopLevel: true });

        const slug = URL.split("/").pop();
        const filePath = path.join(OUT_DIR, `${slug}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`\n✅ Saved: ${filePath}`);
        console.log(`   Top-level comments: ${data.replies.length}`);
        console.log(`   Scraped count: ${data.scrapedCommentsCount}`);
        console.log(`   Metadata count: ${data.commentsCount}`);
    } catch (e) {
        console.error("❌ Error:", e.message);
    } finally {
        await browser.close();
    }
})();
