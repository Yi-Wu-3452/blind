import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setActiveLogFile } from "./logger.mjs";

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
const useRobustScroll = args.includes("--robust-scroll") || args.includes("--robust_scroll");
const scrollInterval = parseInt(args.find(arg => arg.startsWith("--scroll-interval=") || arg.startsWith("--scroll_interval="))?.split("=")[1] || "2000");
const scrollLimit = parseInt(args.find(arg => arg.startsWith("--scroll-limit=") || arg.startsWith("--scroll_limit="))?.split("=")[1] || "20");
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
const accArgIndex = args.indexOf('--account');

const CRED_FILE = path.resolve(__dirname, "../../credentials.json");
let loadedCredentials = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

if (fs.existsSync(CRED_FILE)) {
    try {
        const creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
        if (accArgIndex !== -1 && args[accArgIndex + 1]) {
            const accKey = args[accArgIndex + 1];
            if (creds[accKey]) {
                loadedCredentials = creds[accKey];
            } else {
                console.warn(`⚠️ Account index "${accKey}" not found in credentials.json. Using default.`);
            }
        } else if (userArgIndex !== -1 && args[userArgIndex + 1]) {
            const found = Object.values(creds).find(c => c.email === args[userArgIndex + 1]);
            if (found) {
                loadedCredentials = found;
            } else {
                loadedCredentials.email = args[userArgIndex + 1];
                if (passArgIndex !== -1 && args[passArgIndex + 1]) {
                    loadedCredentials.password = args[passArgIndex + 1];
                }
            }
        }
    } catch (e) {
        console.error("❌ Error loading credentials.json:", e.message);
    }
}

const CREDENTIALS = {
    email: userArgIndex !== -1 && args[userArgIndex + 1] ? args[userArgIndex + 1] : loadedCredentials.email,
    password: passArgIndex !== -1 && args[passArgIndex + 1] ? args[passArgIndex + 1] : loadedCredentials.password
};

// Organic sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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


export async function login(page, options = {}) {
    const { manual: forceManual = false, waitOnly = false, automatic = true, account = null } = options;

    // Refresh credentials if an account key is provided
    let targetCredentials = CREDENTIALS;
    if (account && fs.existsSync(CRED_FILE)) {
        try {
            const creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
            if (creds[account]) {
                targetCredentials = creds[account];
                console.log(`   👤 Using account "${account}": ${targetCredentials.email}`);
            } else {
                console.warn(`   ⚠️ Account "${account}" not found in credentials.json. Using default.`);
            }
        } catch (e) {
            console.error("   ❌ Error loading credentials.json for account switch:", e.message);
        }
    }

    if (waitOnly) {
        console.log("\n--------------------------------------------------");
        console.log("👉 LOGIN WAIT MODE ENABLED.");
        console.log("1. Opening home page...");
        await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" });
        console.log("2. Please SIGN IN manually in the browser.");
        console.log("3. Once you reach the home feed, the script will continue.");
        console.log("--------------------------------------------------");
    } else if (automatic && !forceManual) {
        console.log("🚀 Starting Organic Auto-Login sequence...");

        console.log("   🔑 Navigating to sign-in page...");
        let loginPageSuccess = false;
        let loginPageRetries = 0;
        while (!loginPageSuccess && loginPageRetries < 5) {
            await page.goto("https://www.teamblind.com/sign-in", { waitUntil: "networkidle" });
            await sleep(2000 + Math.random() * 2000);

            const isErrorPage = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes("Oops! Something went wrong");
            });

            if (isErrorPage) {
                loginPageRetries++;
                console.log(`   🔄 Got a temporary ERROR_PAGE on sign-in. Waiting 30 seconds and then refreshing (Retry ${loginPageRetries}/5)...`);
                await page.waitForTimeout(30000);
            } else {
                loginPageSuccess = true;
            }
        }

        // Check if already logged in
        const isLoggedIn = await page.evaluate(() => {
            const hasUserMeta = !!document.querySelector('a[href*="/my-page"], .user_info, button.gnb-btn_user');
            const hasSignOutBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Sign Out'));
            return hasUserMeta || hasSignOutBtn;
        });

        if (isLoggedIn) {
            console.log("   ✅ Already logged in. Skipping login sequence.");
            return;
        }

        // populate credentials human-style
        try {
            const emailSelector = '#email';
            const passwordSelector = '#password';
            const submitSelector = 'button.bg-black, button[type="submit"]';

            console.log("   ⏳ Waiting for email field...");
            await page.waitForSelector(emailSelector, { timeout: 15000, state: 'visible' });

            console.log("   ✍️ Typing credentials...");
            await page.locator(emailSelector).click();
            await sleep(500 + Math.random() * 500);
            await page.locator(emailSelector).type(targetCredentials.email, { delay: 100 + Math.random() * 100 });

            await sleep(800 + Math.random() * 800);
            await page.locator(passwordSelector).click();
            await sleep(500 + Math.random() * 500);
            await page.locator(passwordSelector).type(targetCredentials.password, { delay: 100 + Math.random() * 120 });

            await sleep(1000 + Math.random() * 500);

            // Check for "Stay signed in" checkbox
            const staySignedIn = 'input[name="stay_signed_in"], #stay_signed_in';
            if (await page.locator(staySignedIn).isVisible()) {
                await page.locator(staySignedIn).check();
                await sleep(400 + Math.random() * 400);
            }

            console.log("   🚀 Clicking Sign in button...");
            await page.locator(submitSelector).first().click();

        } catch (error) {
            console.log("   ⚠️ Auto-login interaction error:", error.message);
        }
    } else {
        // Fallback for manual or legacy behavior
        console.log("   ℹ Attempting to load login page...");
        await page.goto("https://www.teamblind.com/login", { waitUntil: "domcontentloaded" });

        try {
            const emailSelector = 'input[name="email"], input[type="email"], input[placeholder*="Email" i]';
            const passwordSelector = 'input[name="password"], input[type="password"], input[placeholder*="Password" i]';

            await page.waitForSelector(emailSelector, { timeout: 15000 });
            await page.locator(emailSelector).first().fill(targetCredentials.email);
            await page.locator(passwordSelector).first().fill(targetCredentials.password);
            console.log("   ✅ Credentials populated.");
        } catch (e) {
            console.log("   ℹ Login form fields not found or already filled (timeout after 15s).");
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
        const result = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const isErrorPage = bodyText.includes("Oops! Something went wrong") && bodyText.includes("blindapp@teamblind.com");
            const isReadOnly = bodyText.includes("read-only mode") || bodyText.includes("Read-only mode");
            const hasNoFeed = !document.querySelector('article');
            const isAccessDenied = bodyText.includes("Access Denied") || bodyText.includes("403 Forbidden");

            if (isErrorPage) return { type: 'ERROR_PAGE' };
            if (isReadOnly) return { type: 'READ_ONLY' };
            if (isAccessDenied) return { type: 'ACCESS_DENIED' };
            // If no articles are found and the page seems small/empty, it's likely a hidden block
            if (hasNoFeed && bodyText.length < 3000) return { type: 'EMPTY_FEED_HIDDEN_BLOCK' };
            return null;
        });

        if (result) {
            console.log(`   🛑 Detected Restriction: ${result.type}`);
            return result;
        }
    } catch (e) {
        // Ignore errors during check
    }
    return null;
}

/**
 * Perform randomized mouse movements to mimic human behavior
 */
async function addMouseJitter(page) {
    try {
        const viewport = page.viewportSize() || { width: 1280, height: 800 };
        const x = Math.floor(Math.random() * viewport.width);
        const y = Math.floor(Math.random() * viewport.height);

        // Randomly move mouse to 1-3 positions
        const moveCount = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < moveCount; i++) {
            const tx = Math.floor(Math.random() * viewport.width);
            const ty = Math.floor(Math.random() * viewport.height);
            await page.mouse.move(tx, ty, { steps: 10 + Math.floor(Math.random() * 10) });
            await sleep(100 + Math.random() * 200);
        }
    } catch (e) {
        // Safe to ignore
    }
}

/**
 * Robust scrolling: dynamic scroll until the post count and page height stabilize
 */
async function robustScroll(page, options = {}) {
    const { interval = 2000, limit = 20, selector = "article a[href*='/post/']" } = options;
    console.log(`   🌊 Starting Refined Robust Scroll (limit: ${limit}, interval: ${interval}ms)...`);

    let lastCount = 0;
    let lastHeight = 0;
    let consecutiveSame = 0;

    for (let i = 1; i <= limit; i++) {
        // Wiggle to trigger lazy loaders and add jitter
        await page.evaluate(() => {
            window.scrollBy(0, -100);
        });
        await addMouseJitter(page);
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });

        // Wait for the interval + dynamic jitter
        const jitter = Math.random() * 1000;
        await page.waitForTimeout(interval + jitter);

        const state = await page.evaluate((sel) => {
            return {
                count: document.querySelectorAll(sel).length,
                height: document.body.scrollHeight
            };
        }, selector);

        if (state.count === lastCount && state.height === lastHeight) {
            if (state.count > 0) {
                consecutiveSame++;
            } else {
                // If 0 posts, we might be loading or blocked. Be more patient but don't wait forever.
                consecutiveSame += 0.5;
            }
        } else {
            consecutiveSame = 0;
        }

        lastCount = state.count;
        lastHeight = state.height;

        if (consecutiveSame >= 3) {
            console.log(`      ✅ Content stabilized at ${state.count} posts (height: ${state.height}) after ${i} scrolls.`);
            break;
        }

        if (i === limit) {
            console.log(`      ⚠️ Reached scroll limit (${limit}). Posts: ${state.count}, Height: ${state.height}`);
        } else if (i % 5 === 0) {
            console.log(`      ...scrolled ${i} times: ${state.count} posts, height ${state.height}...`);
        }
    }

    await page.evaluate(() => window.scrollTo(0, 0));
}

export async function collectUrlsForCompany(page, options = {}) {
    const {
        targetUrl: COMPANY_POSTS_URL,
        outFile,
        startPage = 1,
        scrollCount = 3,
        useSimpleRetry = false,
        patienceLimit = 5,
        useRobustScroll = false,
        scrollInterval = 2000,
        scrollLimit = 20
    } = options;

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let currentPage = startPage;
    let pagesWithNoNewUrls = 0;
    const seenInFile = new Set();
    const seenInThisRun = new Map();
    const duplicateUrls = [];

    const dupFile = outFile.endsWith(".txt") ? outFile.replace(".txt", "_duplicates.json") : outFile + "_duplicates.json";

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
        let blockDetected = null;

        while (retryCount <= maxRetries && !success) {
            try {
                await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
                blockDetected = await checkRateLimit(page);
                if (blockDetected) {
                    throw new Error(`BLOCKED: ${blockDetected.type}`);
                }
                success = true;
            } catch (e) {
                const errorMessage = e.message || String(e);
                const isRetryable = errorMessage.includes("RATE_LIMITED") ||
                    errorMessage.includes("Timeout") ||
                    errorMessage.includes("ERROR_PAGE") ||
                    errorMessage.includes("READ_ONLY") ||
                    errorMessage.includes("net::ERR_") ||
                    errorMessage.includes("EMPTY_FEED_HIDDEN_BLOCK");

                if (isRetryable) {
                    retryCount++;
                    const accumulatedWait = (retryCount * retryInterval) / 1000;

                    if (retryCount > maxRetries) {
                        console.error(`❌ Permanent failure for page ${currentPage} after ${maxRetries} retries: ${errorMessage}`);
                        const screenshotPath = path.resolve(outDir, `error_page_${currentPage}_permanent.png`);
                        await page.screenshot({ path: screenshotPath }).catch(() => { });
                        return { status: 'FAILED', reason: errorMessage, lastPage: currentPage };
                    }

                    console.log(`⚠️ ${errorMessage.includes("RATE_LIMITED") ? "Rate limited" : "Temporary block/error"}. Retry ${retryCount}/${maxRetries} for page ${currentPage} (${accumulatedWait}s/90s)...`);

                    if (errorMessage.includes("RATE_LIMITED") || errorMessage.includes("READ_ONLY") || errorMessage.includes("EMPTY_FEED_HIDDEN_BLOCK") || errorMessage.includes("ERROR_PAGE")) {
                        console.log(`   🧊 Rate limit/block detected. Running 30s deep breath cooler...`);
                        await page.waitForTimeout(30000);
                        await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" }).catch(() => { });
                    }

                    await page.waitForTimeout(retryInterval);
                } else if (errorMessage.startsWith("BLOCKED:")) {
                    console.log(`⚠️ Hard block detected on page ${currentPage}: ${blockDetected ? blockDetected.type : errorMessage}`);
                    return { status: 'BLOCKED', reason: blockDetected ? blockDetected.type : errorMessage, lastPage: currentPage };
                } else {
                    console.error(`❌ Error scraping page ${currentPage}:`, errorMessage);
                    return { status: 'FAILED', reason: errorMessage, lastPage: currentPage };
                }
            }
        }

        if (!success) {
            console.log(`Stopping due to permanent failure on page ${currentPage}.`);
            return { status: 'FAILED', reason: 'PERMANENT_RETRY_FAILURE', lastPage: currentPage };
        }

        if (useRobustScroll) {
            console.log(`   ⏳ Waiting 3s for initial page settle...`);
            await page.waitForTimeout(3000);
            await robustScroll(page, { interval: scrollInterval, limit: scrollLimit });
        } else {
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
        }

        try {
            await page.waitForSelector("article a[href*='/post/']", { timeout: 20000 });
        } catch (e) {
            const isRateLimited = await checkRateLimit(page);
            if (isRateLimited) {
                console.log("   ⚠️ Rate limited detected during selector wait.");
                return { status: 'BLOCKED', reason: isRateLimited.type, lastPage: currentPage };
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
                return { status: 'FAILED', reason: 'NO_LINKS_AFTER_RELOAD', lastPage: currentPage };
            }
        }

        const urls = await page.$$eval("article a[href*='/post/']", anchors => {
            return anchors.map(a => a.href);
        });

        if (urls.length === 0) {
            const finalBlockCheck = await checkRateLimit(page);
            if (finalBlockCheck) {
                console.log(`   🚨 Zero links found AND block detected: ${finalBlockCheck.type}`);
                return { status: 'BLOCKED', reason: finalBlockCheck.type, lastPage: currentPage };
            }
            console.log("No post links found on this page. Stopping.");
            return { status: 'FINISHED', reason: 'EMPTY_PAGE', lastPage: currentPage };
        }

        let newUrlsFound = false;
        for (const url of urls) {
            const cleanUrl = url.split("?")[0];

            if (seenInThisRun.has(cleanUrl)) {
                console.log(`   🔸 Duplicate: ${cleanUrl} (First seen Page ${seenInThisRun.get(cleanUrl)})`);
                duplicateUrls.push({
                    url: cleanUrl,
                    firstPage: seenInThisRun.get(cleanUrl),
                    duplicatePage: currentPage
                });
                // Incremental save
                fs.writeFileSync(dupFile, JSON.stringify(duplicateUrls, null, 2));
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
            return { status: 'FINISHED', reason: 'PATIENCE_LIMIT', lastPage: currentPage };
        }

        const currentUrl = page.url();
        if (currentPage > 1 && !currentUrl.includes(`page=${currentPage}`)) {
            console.log("Redirected away from requested page. Assuming end of pagination.");
            return { status: 'FINISHED', reason: 'REDIRECTED', lastPage: currentPage };
        }

        currentPage++;
        const delay = 5000 + Math.random() * 10000; // Increased delay: 5-15s
        console.log(`   ⏳ Waiting ${Math.round(delay / 1000)}s...`);
        await page.waitForTimeout(delay);
    }

    if (duplicateUrls.length > 0) {
        console.log(`📂 Finalized ${duplicateUrls.length} duplicate encounters in ${dupFile}`);
    }

    console.log(`Finished. Total unique URLs in file: ${seenInFile.size}`);
    console.log(`Finished. Unique URLs found in this run: ${seenInThisRun.size}`);

    return { status: 'FINISHED', reason: 'COMPLETED', lastPage: currentPage, count: seenInThisRun.size };
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

    const useProfile = args.includes("--use-profile");

    console.log(`🚀 Launching Robust Scraper.`);
    console.log(`🎯 Target URL: ${COMPANY_POSTS_URL}`);
    console.log(`📂 Output File: ${outFile}`);

    // Set standalone log file
    const logSuffix = sortOption ? `_${sortOption}` : "";
    const logFile = path.resolve(path.dirname(outFile), `log${logSuffix}.txt`);
    setActiveLogFile(logFile);
    console.log(`📝 Log File: ${logFile}`);

    if (useProfile) {
        const accSuffix = accArgIndex !== -1 && args[accArgIndex + 1] ? `_${args[accArgIndex + 1]}` : "";
        let userDataDir = path.resolve(__dirname, `../../browser_profile${accSuffix}`);
        if (!shouldLogin && !shouldManualLogin) {
            const runId = Date.now().toString();
            userDataDir = path.resolve(__dirname, `../../browser_profile_collector_${runId}${accSuffix}`);
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
        useSimpleRetry,
        useRobustScroll,
        scrollInterval,
        scrollLimit
    });

    await context.close();
    if (browser) await browser.close();
}

// Only run main if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
