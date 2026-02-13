import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.resolve(__dirname, "../../data/tmobile_post_urls.txt");
const OUT_DIR = path.resolve(__dirname, "../../data/tmobile_posts");

// Import the extraction logic from the optimized script
import { extractPostData } from "../core/extract_post_details_optimized.mjs";

const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

async function login(page) {
    console.log("Attempting auto-login...");
    await page.goto("https://www.teamblind.com/login");

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 10000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');

        console.log("Login form submitted. Waiting for redirection...");

        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 30000 });

        console.log("Auto-login successful. Proceeding to scrape...");
    } catch (e) {
        console.log("Auto-login failed or manual intervention required:", e.message);
        console.log("--------------------------------------------------");
        console.log("MANUAL LOGIN REQUIRED:");
        console.log("1. Please check the browser window.");
        console.log("2. Complete any CAPTCHA or log in manually if needed.");
        console.log("3. Once you are logged in and see the home feed, the script will continue automatically.");
        console.log("--------------------------------------------------");

        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 0 });
        console.log("Login detected. Proceeding to scrape...");
    }
}

async function startBatchExtraction() {
    if (!fs.existsSync(IN_FILE)) {
        console.error(`Input file not found: ${IN_FILE}`);
        process.exit(1);
    }

    const urls = fs.readFileSync(IN_FILE, "utf-8").split("\n").filter(u => u.trim());
    console.log(`Starting batch extraction for T-Mobile posts from: ${IN_FILE}`);
    console.log(`Total URLs to process: ${urls.length}`);
    console.log(`Output directory: ${OUT_DIR}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login first
    await login(page);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const url of urls) {
        const identifier = url.split('/').pop() || `post_${Date.now()}`;
        const filePath = `${OUT_DIR}/${identifier}.json`;

        if (fs.existsSync(filePath)) {
            console.log(`[${processed + skipped + errors + 1}/${urls.length}] Skipping (Already scraped): ${url}`);
            skipped++;
            continue;
        }

        try {
            console.log(`[${processed + skipped + errors + 1}/${urls.length}] Processing: ${url}`);
            const data = await extractPostData(page, url);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`✓ Saved: ${filePath}`);
            processed++;
        } catch (e) {
            console.error(`✗ Error scraping ${url}:`, e.message);
            errors++;
        }

        // Respectful delay between requests
        await page.waitForTimeout(3000);
    }

    await browser.close();

    console.log("\n" + "=".repeat(60));
    console.log("BATCH EXTRACTION COMPLETED");
    console.log("=".repeat(60));
    console.log(`Total URLs: ${urls.length}`);
    console.log(`Successfully processed: ${processed}`);
    console.log(`Skipped (already exists): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Output directory: ${OUT_DIR}`);
    console.log("=".repeat(60));
}

startBatchExtraction().catch(console.error);
