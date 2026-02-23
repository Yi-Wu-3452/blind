import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Apply stealth plugin ONLY if requested
const useStealth = process.argv.includes('--use-stealth');

if (useStealth) {
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

const proxyArgIndex = process.argv.indexOf('--proxy');
let proxyConfig = undefined;
if (proxyArgIndex !== -1 && process.argv[proxyArgIndex + 1]) {
    try {
        const rawProxy = process.argv[proxyArgIndex + 1];
        if (rawProxy.startsWith('socks5://')) {
            proxyConfig = { server: rawProxy };
            console.log(`🌐 Using Proxy: ${proxyConfig.server}`);
        } else {
            const pUrl = new URL(rawProxy.startsWith('http') ? rawProxy : `http://${rawProxy}`);
            proxyConfig = { server: `${pUrl.protocol}//${pUrl.host}` };
            if (pUrl.username) proxyConfig.username = decodeURIComponent(pUrl.username);
            if (pUrl.password) proxyConfig.password = decodeURIComponent(pUrl.password);
            console.log(`🌐 Using Proxy: ${proxyConfig.server}`);
        }
    } catch (e) {
        proxyConfig = { server: process.argv[proxyArgIndex + 1] };
        console.log(`🌐 Using Proxy (fallback): ${proxyConfig.server}`);
    }
}

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
    console.log("  node scripts/core/collect_company_urls_robust.mjs --company=<CompanyName> [--out=<output_file>] [--start-page=<n>] [--scroll-count=<n>] [--sort=<option>] [--login] [--manual-login] [--headless] [--user <email>] [--pass <password>] [--simple-retry] [--use-stealth] [--use-profile] [--proxy <proxy_url>]");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --url=<TargetURL> [--out=<output_file>] [--start-page=<n>] [--scroll-count=<n>] [--sort=<option>] [--login] [--manual-login] [--headless] [--user <email>] [--pass <password>] [--simple-retry] [--use-stealth] [--use-profile] [--proxy <proxy_url>]");
    console.log("\nExamples:");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --company=Fox");
    console.log("  node scripts/core/collect_company_urls_robust.mjs --url=https://www.teamblind.com/company/Fox/posts");
}

// Validation is now handled in main() or by the caller

function getFormattedTime() {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
}

let COMPANY_POSTS_URL = targetUrl || `https://www.teamblind.com/company/${companyName}/posts`;
if (sortOption && !targetUrl) {
    COMPANY_POSTS_URL += `?sort=${sortOption}`;
}

if (!outFile) {
    const name = companyName || "company_posts";
    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
    outFile = path.resolve(__dirname, `../../data/company_post_urls/${safeName}/${safeName}.json`);
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

export async function collectUrlsForCompany(page, options = {}) {
    const {
        targetUrl: COMPANY_POSTS_URL,
        outFile,
        startPage = 1,
        scrollCount = 3,
        useSimpleRetry = false,
        patienceLimit = 5
    } = options;

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let currentPage = startPage;
    let pagesWithNoNewUrls = 0;
    const seenInFile = new Set();
    const seenInThisRun = new Map();
    const duplicateUrls = [];

    if (fs.existsSync(outFile)) {
        if (outFile.endsWith(".json")) {
            try {
                const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
                data.forEach(item => {
                    if (item.url) seenInFile.add(item.url.trim());
                });
            } catch (e) {
                console.error(`Error reading ${outFile} as JSON: ${e.message}`);
            }
        } else {
            fs.readFileSync(outFile, "utf-8").split("\n").forEach(url => {
                if (url.trim()) seenInFile.add(url.trim());
            });
        }
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
        const retryInterval = 20000 + Math.random() * 20000;

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
                    await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" }).catch(() => { });
                }
                await page.waitForTimeout(retryInterval);
            }
        }

        if (!success) {
            console.log(`Stopping due to permanent failure on page ${currentPage}.`);
            break;
        }

        console.log(`   📜 Scrolling ${scrollCount} times to ensure all posts load...`);
        try {
            for (let i = 0; i < scrollCount; i++) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1500);
            }
            await page.evaluate(() => window.scrollTo(0, 0));
        } catch (e) {
            console.log("   ⚠️ Error during scroll: " + e.message);
        }

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
                await page.waitForTimeout(3000);
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

            if (seenInThisRun.has(cleanUrl)) {
                duplicateUrls.push({
                    url: cleanUrl,
                    firstPage: seenInThisRun.get(cleanUrl),
                    duplicatePage: currentPage
                });
            } else {
                seenInThisRun.set(cleanUrl, currentPage);
            }

            if (!seenInFile.has(cleanUrl)) {
                seenInFile.add(cleanUrl);

                if (outFile.endsWith(".json")) {
                    let currentData = [];
                    if (fs.existsSync(outFile)) {
                        try {
                            currentData = JSON.parse(fs.readFileSync(outFile, "utf-8"));
                        } catch (e) { }
                    }
                    currentData.push({
                        url: cleanUrl,
                        scraped_at: getFormattedTime()
                    });
                    fs.writeFileSync(outFile, JSON.stringify(currentData, null, 2));
                } else {
                    fs.appendFileSync(outFile, cleanUrl + "\n");
                }

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
        const delay = Math.floor(Math.random() * 3000) + 3000;
        await page.waitForTimeout(delay);
    }

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

async function main() {
    if (args.includes("--help") || args.includes("-h")) {
        printUsage();
        return;
    }

    if (!companyName && !targetUrl) {
        console.error("Error: Please provide either --company or --url.");
        printUsage();
        process.exit(1);
    }

    let context;
    let browser;

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--window-size=1280,800',
    ];

    const useProfile = args.includes("--use-profile") || shouldLogin || shouldManualLogin;

    console.log(`🚀 Launching Robust Scraper.`);
    console.log(`🎯 Target URL: ${COMPANY_POSTS_URL}`);
    console.log(`📂 Output File: ${outFile}`);

    if (useProfile) {
        let userDataDir = path.resolve(__dirname, `../../browser_profile`);
        if (!shouldLogin && !shouldManualLogin) {
            const runId = Date.now().toString();
            userDataDir = path.resolve(__dirname, `../../browser_profile_collector_${runId}`);
        }
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
        console.log(`📂 Profile: ${userDataDir}`);

        context = await chromium.launchPersistentContext(userDataDir, {
            headless: isHeadless,
            proxy: proxyConfig,
            args: browserArgs,
            viewport: null
        });
    } else {
        console.log(`🌐 Using Ephemeral Context (no profile).`);
        browser = await chromium.launch({
            headless: isHeadless,
            proxy: proxyConfig,
            args: browserArgs
        });
        context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    if (shouldLogin || shouldManualLogin) {
        await login(page, { manual: shouldManualLogin });
    }

    await collectUrlsForCompany(page, {
        targetUrl: COMPANY_POSTS_URL,
        outFile,
        startPage,
        scrollCount,
        useSimpleRetry
    });

    await context.close();
    if (browser) await browser.close();
}

// Only run main if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
