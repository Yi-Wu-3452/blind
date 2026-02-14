import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, dismissBlockers } from "./core/extract_post_details_optimized.mjs";

const useStealth = !process.argv.includes("--no-stealth");
if (useStealth) chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI args ---
const urlFile = process.argv[2];
if (!urlFile) {
    console.error("Usage: node batch_capture_toplevel.mjs <url-file> [--delay=2000]");
    process.exit(1);
}

const delayFlag = process.argv.find(a => a.startsWith("--delay="));
const DELAY_MS = delayFlag ? parseInt(delayFlag.split("=")[1], 10) : 2000;

// --- Directories ---
const OUT_DIR = path.resolve(__dirname, "../data/test_output");
const LOG_DIR = path.resolve(OUT_DIR, "logs");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// --- Read URLs ---
const urls = fs.readFileSync(urlFile, "utf-8")
    .split("\n")
    .map(u => u.trim())
    .filter(u => u.startsWith("http"));

console.log(`📋 Loaded ${urls.length} URLs from ${urlFile}`);

// --- Helper: create per-post logger ---
function createLogger(slug) {
    const logFile = path.join(LOG_DIR, `${slug}.log`);
    fs.writeFileSync(logFile, ""); // clear
    return {
        log: (...args) => {
            const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            process.stdout.write(line);
            try { fs.appendFileSync(logFile, line); } catch { }
        },
        error: (...args) => {
            const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
            const line = `[${new Date().toISOString()}] ERROR: ${msg}\n`;
            process.stderr.write(line);
            try { fs.appendFileSync(logFile, line); } catch { }
        }
    };
}

// --- Main ---
(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Block analytics/ads
    await context.route("**/*", (route) => {
        const url = route.request().url();
        if (url.includes("google-analytics") ||
            url.includes("googletagmanager") ||
            url.includes("facebook.com/tr")) {
            route.abort();
        } else {
            route.continue();
        }
    });

    const page = await context.newPage();

    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const slug = url.split("/").pop();
        const filePath = path.join(OUT_DIR, `${slug}.json`);

        // Skip if already scraped
        if (fs.existsSync(filePath)) {
            console.log(`⏭️  [${i + 1}/${urls.length}] Skipping ${slug} (exists)`);
            skipped++;
            continue;
        }

        const logger = createLogger(slug);
        logger.log(`▶️  [${i + 1}/${urls.length}] Processing: ${slug}`);

        try {
            await page.goto(url, { waitUntil: "domcontentloaded", referer: "https://www.teamblind.com/" });
            const data = await extractPostData(page, url, logger, { captureTopLevel: true });

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            logger.log(`✅ Saved: ${filePath}`);
            logger.log(`   Top-level: ${data.replies.length} | Scraped: ${data.scrapedCommentsCount} | Metadata: ${data.commentsCount}`);
            succeeded++;
        } catch (e) {
            logger.error(`Failed on ${slug}: ${e.message}`);
            failed++;
        }

        // Delay between posts to reduce rate-limit risk
        if (i < urls.length - 1) {
            await new Promise(r => setTimeout(r, DELAY_MS));
        }
    }

    console.log(`\n📊 Done: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed (out of ${urls.length})`);
    await browser.close();
})();
