import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_POSTS_URL = "https://www.teamblind.com/company/T-Mobile/posts";
const OUT_FILE = path.resolve(__dirname, "../../data/tmobile_post_urls.txt");

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

async function collectUrls() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    // Login first to ensure full access
    await login(page);

    let currentPage = 1;
    const seenUrls = new Set();

    // Create data directory if it doesn't exist
    const dataDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(OUT_FILE)) {
        fs.readFileSync(OUT_FILE, "utf-8").split("\n").forEach(url => {
            if (url.trim()) seenUrls.add(url.trim());
        });
    }

    const TARGET_PAGES = 60; // User said there are 56 pages
    let consecutiveEmptyPages = 0;

    while (currentPage <= TARGET_PAGES) {
        console.log(`\n--- Processing Page ${currentPage} ---`);

        let attempts = 0;
        let success = false;
        let urls = [];

        while (attempts < 3 && !success) {
            attempts++;
            try {
                // Varying delay between page loads to look more human
                const delay = Math.floor(Math.random() * 3000) + 2000;
                console.log(`Waiting ${delay}ms before loading...`);
                await page.waitForTimeout(delay);

                console.log(`Loading page ${currentPage} (Attempt ${attempts})...`);
                await page.goto(`${COMPANY_POSTS_URL}?page=${currentPage}`, { waitUntil: "networkidle", timeout: 45000 });

                // Wait for any post element to appear
                try {
                    await page.waitForSelector('a[href*="/post/"]', { timeout: 10000 });
                } catch (e) {
                    console.log(`No post links found on page ${currentPage} within 10s.`);
                }

                urls = await page.$$eval("a[href*='/post/']", anchors => {
                    const results = [];
                    anchors.forEach(a => {
                        if (a.href && a.href.includes('/post/') && !a.href.includes('/company/') && !a.href.includes('/blog/')) {
                            results.push(a.href);
                        }
                    });
                    return results;
                });

                if (urls.length > 0) {
                    success = true;
                } else {
                    console.log(`No URLs found on page ${currentPage}. This might be a block or empty page.`);
                    // Small scroll to trigger any lazy loading
                    await page.mouse.wheel(0, 500);
                    await page.waitForTimeout(1000);
                }
            } catch (e) {
                console.error(`Error on page ${currentPage}, attempt ${attempts}:`, e.message);
                if (e.message.includes('closed')) break;
                await page.waitForTimeout(5000);
            }
        }

        if (urls.length === 0) {
            console.log(`⚠ Page ${currentPage} remained empty after ${attempts} attempts.`);
            consecutiveEmptyPages++;
        } else {
            consecutiveEmptyPages = 0;
            let newUrlsCount = 0;
            for (const url of urls) {
                const cleanUrl = url.split("?")[0];
                if (!seenUrls.has(cleanUrl)) {
                    seenUrls.add(cleanUrl);
                    fs.appendFileSync(OUT_FILE, cleanUrl + "\n");
                    newUrlsCount++;
                }
            }
            console.log(`✓ Page ${currentPage}: Found ${urls.length} posts, ${newUrlsCount} were new.`);
        }

        // If we hit too many empty pages in a row, we might be truly at the end or blocked hard
        if (consecutiveEmptyPages >= 5) {
            console.log("Too many consecutive empty pages. Stopping.");
            break;
        }

        currentPage++;
    }

    await browser.close();
    console.log(`\nScraping Finished. Total unique URLs: ${seenUrls.size}`);
}

collectUrls().catch(console.error);
