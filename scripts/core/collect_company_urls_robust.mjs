import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Apply stealth plugin ONLY if login is not required
const isLoginActive = process.argv.includes('--login') ||
    process.argv.includes('--manual-login');

if (!isLoginActive) {
    chromium.use(stealth());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
const args = process.argv.slice(2);
const companyName = args.find(arg => arg.startsWith("--company="))?.split("=")[1];
const targetUrl = args.find(arg => arg.startsWith("--url="))?.split("=")[1];
let outFile = args.find(arg => arg.startsWith("--out="))?.split("=")[1];
const startPage = parseInt(args.find(arg => arg.startsWith("--start-page="))?.split("=")[1] || "1");
const shouldLogin = args.includes("--login");
const shouldManualLogin = args.includes("--manual-login");
const isHeadless = args.includes("--headless");
const scrollCount = parseInt(args.find(arg => arg.startsWith("--scroll-count="))?.split("=")[1] || "3");
const sortOption = args.find(arg => arg.startsWith("--sort="))?.split("=")[1];
const useSimpleRetry = args.includes("--simple-retry");

const userArgIndex = args.indexOf('--user');
const passArgIndex = args.indexOf('--pass');

const CREDENTIALS = {
    email: userArgIndex !== -1 && args[userArgIndex + 1] ? args[userArgIndex + 1] : "fortestblind2026@gmail.com",
    password: passArgIndex !== -1 && args[passArgIndex + 1] ? args[passArgIndex + 1] : "fortest00001!"
};

// Override with second_account.txt if no CLI args provided and --login is used
if (shouldLogin && userArgIndex === -1) {
    const credPath = path.resolve(__dirname, "../../second_account.txt");
    if (fs.existsSync(credPath)) {
        const lines = fs.readFileSync(credPath, "utf-8").split("\n");
        CREDENTIALS.email = lines[0]?.trim() || CREDENTIALS.email;
        CREDENTIALS.password = lines[1]?.trim() || CREDENTIALS.password;
    }
}

function printUsage() {
    console.log("Usage:");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --company=<CompanyName> [--out=<output_file>] [--start-page=<n>] [--scroll-count=<n>] [--sort=<option>] [--login] [--manual-login] [--headless] [--user <email>] [--pass <password>] [--simple-retry]");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --url=<TargetURL> [--out=<output_file>] [--start-page=<n>] [--scroll-count=<n>] [--sort=<option>] [--login] [--manual-login] [--headless] [--user <email>] [--pass <password>] [--simple-retry]");
    console.log("\nExamples:");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --company=Fox");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --url=https://www.teamblind.com/company/Fox/posts");
}

if (!companyName && !targetUrl) {
    console.error("Error: Please provide either --company or --url.");
    printUsage();
    process.exit(1);
}

let COMPANY_POSTS_URL = targetUrl || `https://www.teamblind.com/company/${companyName}/posts`;
if (sortOption && !targetUrl) {
    COMPANY_POSTS_URL += `?sort=${sortOption}`;
}

if (!outFile) {
    const name = companyName || "company_posts";
    outFile = path.resolve(__dirname, `../../data/${name.toLowerCase()}_post_urls.txt`);
} else {
    // Resolve relative path if provided
    if (!path.isAbsolute(outFile)) {
        outFile = path.resolve(process.cwd(), outFile);
    }
}

async function login(page, options = {}) {
    const { manual: forceManual = false, waitOnly = false } = options;

    if (waitOnly) {
        // ... (waitOnly logic)
    } else {
        console.log("Checking login status (trying /my-page)...");
        try {
            await page.goto("https://www.teamblind.com/my-page", { waitUntil: "domcontentloaded", timeout: 15000 });
            const currentUrl = page.url();

            if (!currentUrl.includes("/login") && !currentUrl.includes("/sign-in") && !currentUrl.includes("/login-required")) {
                console.log(`   ✅ Already logged in (session active).`);
                return;
            }
        } catch (e) {
            console.log("   ℹ /my-page check timed out or failed. Proceeding to login flow.");
        }

        console.log("   ℹ Not logged in. Attempting to load login page...");
        await page.goto("https://www.teamblind.com/login", { waitUntil: "domcontentloaded" });

        // ALWAYS try to populate credentials to assist the user
        try {
            const emailSelector = 'input[name="email"], input[type="email"], input[placeholder*="Email" i]';
            const passwordSelector = 'input[name="password"], input[type="password"], input[placeholder*="Password" i]';

            await page.waitForSelector(emailSelector, { timeout: 15000 });

            await page.locator(emailSelector).first().fill(CREDENTIALS.email);
            await page.locator(passwordSelector).first().fill(CREDENTIALS.password);

            console.log("   ✅ Credentials populated.");
        } catch (e) {
            console.log("   ℹ Login form fields not found or already filled (timeout after 15s).");
        }

        if (!forceManual) {
            try {
                const submitBtn = await page.locator('button[type="submit"], button:has-text("Sign in"), button.bg-black').first();
                await submitBtn.click();
                console.log("   🚀 Login form submitted. Waiting for redirection...");

                await page.waitForFunction(() => {
                    const url = window.location.href;
                    return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
                }, { timeout: 15000 });

                console.log("✅ Auto-login successful. Proceeding...");
                return; // Success
            } catch (e) {
                console.log("   ⚠️ Auto-submit failed or manual intervention required:", e.message);
            }
        }

        console.log("--------------------------------------------------");
        console.log("👉 MANUAL LOGIN INTERVENTION:");
        console.log("1. Please check the browser window.");
        console.log("2. Credentials have been pre-filled for you.");
        console.log("3. Solve any CAPTCHAs and click Submit.");
        console.log("4. Once you reach the home feed, the script will continue.");
        console.log("--------------------------------------------------");
    }

    console.log("   Waiting for login detection (URL matching active)...");
    try {
        page.setDefaultTimeout(0); // Infinite wait
        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 0 });

        console.log("✅ Login detected. Proceeding to scrape...");
    } catch (waitError) {
        if (waitError.message.includes('Target page, context or browser has been closed')) {
            console.error("\n❌ Browser closed. Exiting...");
            process.exit(1);
        } else {
            console.error("\n❌ Manual login wait failed:", waitError.message);
            process.exit(1);
        }
    }
}

async function checkRateLimit(page) {
    try {
        const errorText = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            if (bodyText.includes("Oops! Something went wrong") && bodyText.includes("blindapp@teamblind.com")) {
                return true;
            }
            return false;
        });

        if (errorText) {
            console.log("   🛑 Detected Blind Error Page (Rate Limit?).");
            return true;
        }
    } catch (e) {
        // Ignore errors during check
    }
    return false;
}

async function collectUrls() {
    let userDataDir;
    if (shouldLogin || shouldManualLogin) {
        userDataDir = path.resolve(__dirname, `../../browser_profile`);
    } else {
        const runId = Date.now().toString();
        userDataDir = path.resolve(__dirname, `../../browser_profile_collector_${runId}`);
    }
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    console.log(`🚀 Launching Robust Scraper.`);
    console.log(`🎯 Target URL: ${COMPANY_POSTS_URL}`);
    console.log(`📂 Output File: ${outFile}`);
    console.log(`📂 Profile: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: isHeadless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--window-size=1280,800',
        ],
        viewport: null
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    if (shouldLogin || shouldManualLogin) {
        await login(page, { manual: shouldManualLogin });
    }

    let currentPage = startPage;
    let pagesWithNoNewUrls = 0;
    const patienceLimit = 5;
    const seenInFile = new Set();
    const seenInThisRun = new Map();
    const duplicateUrls = [];

    if (fs.existsSync(outFile)) {
        fs.readFileSync(outFile, "utf-8").split("\n").forEach(url => {
            if (url.trim()) seenInFile.add(url.trim());
        });
    }

    while (true) {
        console.log(`Fetching page ${currentPage}...`);
        let pageUrl = COMPANY_POSTS_URL;

        if (pageUrl.includes("?")) {
            pageUrl += `&page=${currentPage}`;
        } else {
            pageUrl += `?page=${currentPage}`;
        }

        let success = false;
        let retryCount = 0;
        const maxRetries = useSimpleRetry ? 1 : 9;
        const retryInterval = 10000;

        while (retryCount <= maxRetries && !success) {
            try {
                await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
                const isRateLimited = await checkRateLimit(page);
                if (isRateLimited) {
                    throw new Error("RATE_LIMITED");
                }
                success = true;
            } catch (e) {
                retryCount++;
                if (retryCount > maxRetries) {
                    console.error(`❌ Permanent failure for page ${currentPage} after ${maxRetries} retries: ${e.message}`);
                    const screenshotPath = path.resolve(outDir, `error_page_${currentPage}_permanent.png`);
                    await page.screenshot({ path: screenshotPath }).catch(() => { });
                    break;
                }

                console.log(`⚠️ ${e.message.includes("RATE_LIMITED") ? "Rate limited" : "Timeout"}. Retry ${retryCount}/${maxRetries} for page ${currentPage}...`);
                if (e.message.includes("RATE_LIMITED")) {
                    // Try to "unstick" by going to home page
                    await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" }).catch(() => { });
                }
                await page.waitForTimeout(retryInterval);
            }
        }

        if (!success) {
            console.log(`Stopping due to permanent failure on page ${currentPage}.`);
            break;
        }

        // --- ROBUST SCROLLING ---
        console.log(`   📜 Scrolling ${scrollCount} times to ensure all posts load...`);
        try {
            // Scroll down multiple times to trigger lazy loading
            for (let i = 0; i < scrollCount; i++) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1500);
            }
            await page.evaluate(() => window.scrollTo(0, 0)); // Scroll back up slightly just in case (optional)
        } catch (e) {
            console.log("   ⚠️ Error during scroll: " + e.message);
        }

        // Wait for selectors
        try {
            await page.waitForSelector("article a[href*='/post/']", { timeout: 20000 });
        } catch (e) {
            const isRateLimited = await checkRateLimit(page);
            if (isRateLimited) {
                console.log("   ⚠️ Rate limited detected during selector wait.");
            } else {
                console.log("   ⚠️ Timeout waiting for post links (20s). Retrying reload...");
            }

            await page.reload({ waitUntil: "domcontentloaded" });
            try {
                await page.waitForTimeout(3000); // Hard wait after reload
                await page.waitForSelector("article a[href*='/post/']", { timeout: 15000 });
            } catch (retryError) {
                console.log("   ❌ Still no post links after reload. Main feed might be empty or blocked.");
                const screenshotPath = path.resolve(outDir, `error_page_${currentPage}_content.png`);
                await page.screenshot({ path: screenshotPath }).catch(() => { });
                console.log(`      Saved screenshot to ${screenshotPath}`);
            }
        }

        const urls = await page.$$eval("article a[href*='/post/']", anchors => {
            return anchors.map(a => a.href);
        });

        if (urls.length === 0) {
            console.log("No post links found on this page. Stopping.");
            break;
        }

        let newUrlsFound = false;
        for (const url of urls) {
            const cleanUrl = url.split("?")[0];

            // 1. Is it a duplicate in THIS run?
            if (seenInThisRun.has(cleanUrl)) {
                duplicateUrls.push({
                    url: cleanUrl,
                    firstPage: seenInThisRun.get(cleanUrl),
                    duplicatePage: currentPage
                });
            } else {
                seenInThisRun.set(cleanUrl, currentPage);
            }

            // 2. Is it new to the FILE?
            if (!seenInFile.has(cleanUrl)) {
                seenInFile.add(cleanUrl);
                fs.appendFileSync(outFile, cleanUrl + "\n");
                console.log(`+ ${cleanUrl}`);
                newUrlsFound = true;
            }
        }

        if (newUrlsFound) {
            pagesWithNoNewUrls = 0;
        } else {
            pagesWithNoNewUrls++;
            console.log(`  ℹ No new URLs found for ${pagesWithNoNewUrls} consecutive page(s).`);
        }

        console.log(`Page ${currentPage}: Found ${urls.length} links, ${newUrlsFound ? "some new" : "no new"} URLs.`);

        if (pagesWithNoNewUrls >= patienceLimit) {
            console.log(`\nStopping: Reached patience limit of ${patienceLimit} pages with no new URLs.`);
            break;
        }

        const currentUrl = page.url();
        if (currentPage > 1 && !currentUrl.includes(`page=${currentPage}`)) {
            console.log("Redirected away from requested page. Assuming end of pagination.");
            break;
        }

        currentPage++;

        // Increased delay between pages
        const delay = Math.floor(Math.random() * 3000) + 3000;
        await page.waitForTimeout(delay);
    }

    await context.close();

    // Save duplicates to JSON - FIXED FILENAME LOGIC
    if (duplicateUrls.length > 0) {
        let dupFile;
        if (outFile.endsWith(".txt")) {
            dupFile = outFile.replace(".txt", "_duplicates.json");
        } else {
            dupFile = outFile + "_duplicates.json";
        }

        fs.writeFileSync(dupFile, JSON.stringify(duplicateUrls, null, 2));
        console.log(`📂 Saved ${duplicateUrls.length} duplicate encounters to ${dupFile}`);
    }

    console.log(`Finished. Total unique URLs in file: ${seenInFile.size}`);
    console.log(`Finished. Unique URLs found in this run: ${seenInThisRun.size}`);
}

collectUrls().catch(console.error);
