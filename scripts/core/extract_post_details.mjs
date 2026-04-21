import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const usePrevRetry = process.argv.includes('--prev-retry');

// Stealth is opt-in only
if (process.argv.includes('--use-stealth')) {
    chromium.use(stealth());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const companyListArg = args.find(arg => arg.startsWith('--company-list='));
const COMPANY_LIST_PATH = companyListArg ? path.resolve(companyListArg.split('=')[1]) : null;

const inArgIdx = process.argv.findIndex((arg, idx) => idx >= 2 && !arg.startsWith('--') && (arg.endsWith('.txt') || arg.endsWith('.json') || arg.startsWith('http')));
const IN_FILE = inArgIdx !== -1 && (fs.existsSync(process.argv[inArgIdx]) || process.argv[inArgIdx].startsWith('http'))
    ? (process.argv[inArgIdx].startsWith('http') ? process.argv[inArgIdx] : path.resolve(process.argv[inArgIdx]))
    : (COMPANY_LIST_PATH ? null : path.resolve(__dirname, "../../data/nvidia_post_urls.txt"));

const outArgIdx = process.argv.findIndex((arg, idx) => idx > Math.max(1, inArgIdx) && !arg.startsWith('--'));
const DEFAULT_OUT_DIR = outArgIdx !== -1 && process.argv[outArgIdx]
    ? path.resolve(process.argv[outArgIdx])
    : path.resolve(__dirname, "../../data/posts_optimized");
const userArgIndex = process.argv.indexOf('--user');
const passArgIndex = process.argv.indexOf('--pass');
const accArgIndex = process.argv.indexOf('--account');

const CRED_FILE = path.resolve(__dirname, "../../credentials.json");
let loadedCredentials = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

if (fs.existsSync(CRED_FILE)) {
    try {
        const creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
        if (accArgIndex !== -1 && process.argv[accArgIndex + 1]) {
            const accKey = process.argv[accArgIndex + 1];
            if (creds[accKey]) {
                loadedCredentials = creds[accKey];
            } else {
                console.warn(`⚠️ Account index "${accKey}" not found in credentials.json. Using default.`);
            }
        } else if (userArgIndex !== -1 && process.argv[userArgIndex + 1]) {
            // Check if email match in JSON
            const found = Object.values(creds).find(c => c.email === process.argv[userArgIndex + 1]);
            if (found) {
                loadedCredentials = found;
            } else {
                loadedCredentials.email = process.argv[userArgIndex + 1];
                if (passArgIndex !== -1 && process.argv[passArgIndex + 1]) {
                    loadedCredentials.password = process.argv[passArgIndex + 1];
                }
            }
        }
    } catch (e) {
        console.error("❌ Error loading credentials.json:", e.message);
    }
}

const CREDENTIALS = {
    email: userArgIndex !== -1 && process.argv[userArgIndex + 1] ? process.argv[userArgIndex + 1] : loadedCredentials.email,
    password: passArgIndex !== -1 && process.argv[passArgIndex + 1] ? process.argv[passArgIndex + 1] : loadedCredentials.password
};

const SHOULD_LOGIN = false;

// OPTIMIZATION: Balanced wait times - faster but still robust
const WAIT_AFTER_CLICK = 1000; // Balanced: fast but ensures comments load
const WAIT_AFTER_NAVIGATION = 1200; // Balanced: ensures page restores properly
const LOAD_MORE_TIMEOUT = 5000; // Balanced: gives enough time for slow loads

// Organic Navigation Constants
const COMPANY_POSTS_URL = "https://www.teamblind.com/company/T-Mobile/posts";
const BASE_REFERER = "https://www.teamblind.com/company/T-Mobile/";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normalizeDate(dateStr, referenceTime) {
    if (!dateStr) return "";
    const cleanStr = dateStr.trim().replace(/·/g, '').trim();
    if (!cleanStr) return "";

    const now = new Date(referenceTime);

    const relativeMatch = cleanStr.match(/^(\d+)([dhms])$/);
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2];
        const date = new Date(now);
        if (unit === 'd') date.setDate(date.getDate() - value);
        else if (unit === 'h') date.setHours(date.getHours() - value);
        else if (unit === 'm') date.setMinutes(date.getMinutes() - value);
        else if (unit === 's') date.setSeconds(date.getSeconds() - value);
        return date.toISOString().split('T')[0];
    }

    if (cleanStr.includes(',')) {
        const date = new Date(cleanStr);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }

    const monthDayMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
    if (monthDayMatch) {
        const monthStr = monthDayMatch[1];
        const day = parseInt(monthDayMatch[2], 10);
        const year = now.getFullYear();
        const date = new Date(`${monthStr} ${day}, ${year}`);

        if (date > now) {
            date.setFullYear(year - 1);
        }

        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }

    const fallbackDate = new Date(cleanStr);
    if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate.toISOString().split('T')[0];
    }

    return cleanStr;
}

function getFormattedScrapeTime() {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
}

async function login(page, options = {}) {
    const { manual: forceManual = false, waitOnly = false, automatic = false, semiAuto = false } = options;

    if (waitOnly) {
        console.log("\n--------------------------------------------------");
        console.log("👉 LOGIN WAIT MODE ENABLED.");
        console.log("1. Opening home page...");
        await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" });
        console.log("2. Please SIGN IN manually in the browser.");
        console.log("3. Once you reach the home feed, the script will continue.");
        console.log("--------------------------------------------------");
    } else if (automatic) {
        console.log("🚀 Starting Organic Auto-Login sequence (--auto-login)...");

        // Direct navigate to sign-in page (more reliable than /login or /session-out)
        console.log("   🔑 Navigating to sign-in page...");
        await page.goto("https://www.teamblind.com/sign-in", { waitUntil: "networkidle" });
        await sleep(2000 + Math.random() * 2000);

        // Check if already logged in (Look for profile icon or sign out link)
        const isLoggedIn = await page.evaluate(() => {
            const hasUserMeta = !!document.querySelector('a[href*="/my-page"], .user_info, button.gnb-btn_user');
            const hasSignOutBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Sign Out'));
            return hasUserMeta || hasSignOutBtn;
        });

        if (isLoggedIn) {
            console.log("   ✅ Already logged in. Skipping login sequence.");
            return;
        }

        // Step 2: Populate credentials human-style
        try {
            const emailSelector = '#email';
            const passwordSelector = '#password';
            const submitSelector = 'button.bg-black, button[type="submit"]';

            console.log("   ⏳ Waiting for email field...");
            await page.waitForSelector(emailSelector, { timeout: 15000, state: 'visible' });

            console.log("   ✍️ Typing credentials...");
            await page.locator(emailSelector).click();
            await sleep(500 + Math.random() * 500);
            await page.locator(emailSelector).type(CREDENTIALS.email, { delay: 100 + Math.random() * 100 });

            await sleep(800 + Math.random() * 800);
            await page.locator(passwordSelector).click();
            await sleep(500 + Math.random() * 500);
            await page.locator(passwordSelector).type(CREDENTIALS.password, { delay: 100 + Math.random() * 120 });

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
        // Original --login or --manual-login behavior
        console.log("Attempting to load login page and populate credentials...");
        await page.goto("https://www.teamblind.com/login", { waitUntil: "domcontentloaded" });

        // ALWAYS try to populate credentials to assist the user
        try {
            // Broad selectors to handle potential UI changes
            const emailSelector = 'input[name="email"], input[type="email"], input[placeholder*="Email" i]';
            const passwordSelector = 'input[name="password"], input[type="password"], input[placeholder*="Password" i]';

            await page.waitForSelector(emailSelector, { timeout: 15000 });

            await page.locator(emailSelector).first().fill(CREDENTIALS.email);
            await page.locator(passwordSelector).first().fill(CREDENTIALS.password);

            console.log("   ✅ Credentials populated.");
        } catch (e) {
            console.log("   ℹ Login form fields not found or already filled (timeout after 15s).");
        }

        if (semiAuto && !forceManual) {
            try {
                await page.click('button[type="submit"]');
                console.log("   🚀 Login form submitted. Waiting for redirection...");
            } catch (e) {
                console.log("   ⚠️ Auto-submit failed:", e.message);
            }
        } else {
            console.log("--------------------------------------------------");
            console.log("👉 MANUAL LOGIN INTERVENTION:");
            console.log("1. Please check the browser window.");
            console.log("2. Credentials have been pre-filled for you.");
            console.log("3. Solve any CAPTCHAs and click Submit.");
            console.log("4. Once you reach the home feed, the script will continue.");
            console.log("--------------------------------------------------");
        }
    }

    // Detection Logic
    console.log("   🔍 Monitoring login status (watching for redirection or session cookie)...");
    try {
        page.setDefaultTimeout(0); // Infinite wait for manual/captcha
        await page.waitForFunction(() => {
            const url = window.location.href;
            const success = !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
            const hasUserIcon = !!document.querySelector('a[href*="/my-page"], .user_info, button.gnb-btn_user');
            return success || hasUserIcon;
        }, { timeout: 0 });

        console.log("✅ Login successful. Proceeding...");
        await sleep(1500 + Math.random() * 1000); // Final "human" pause before starting work
    } catch (waitError) {
        console.error("\n❌ Login detection failed:", waitError.message);
        process.exit(1);
    }
}

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function downloadAllImages(data, postUrl, logger = console, outDirOverride = null) {
    const imagesDir = path.resolve(outDirOverride || OUT_DIR, "images");
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const postSlug = postUrl.split("/").pop();
    const postImageDir = path.join(imagesDir, postSlug);
    if (!fs.existsSync(postImageDir)) fs.mkdirSync(postImageDir, { recursive: true });

    const downloadTask = async (url, sourceId, targetArray) => {
        try {
            const urlWithoutParams = url.split("?")[0];
            const originalFilename = urlWithoutParams.split("/").pop();
            const localFilename = `${sourceId}_${originalFilename}`;
            const filePath = path.join(postImageDir, localFilename);

            if (!fs.existsSync(filePath)) {
                await downloadFile(url, filePath);
                logger.log(`  Downloaded: ${localFilename}`);
            }
            targetArray.push(localFilename);
        } catch (e) {
            logger.log(`  Failed to download ${url}: ${e.message}`);
        }
    };

    data.localImages = [];
    if (data.images) {
        for (const url of data.images) {
            await downloadTask(url, "post", data.localImages);
        }
    }

    const processReplies = async (replies) => {
        for (const r of replies) {
            r.localImages = [];
            if (r.images) {
                for (const url of r.images) {
                    await downloadTask(url, r.commentId, r.localImages);
                }
            }
            if (r.nested) await processReplies(r.nested);
        }
    };

    await processReplies(data.replies);
}

// OPTIMIZATION: Smart wait that ensures comments are fully loaded
// This waits until BOTH the DOM stabilizes AND we see no new comments for a period
async function waitForDOMStability(page, minStableTime = 300, maxWait = 3000) {
    const startTime = Date.now();
    let lastCommentCount = await page.$$eval('div[id^="comment-"]', els => els.length);
    let stableStartTime = null;

    while (Date.now() - startTime < maxWait) {
        await page.waitForTimeout(150);
        const currentCount = await page.$$eval('div[id^="comment-"]', els => els.length);

        if (currentCount === lastCommentCount) {
            // Count is stable - start/continue stability timer
            if (stableStartTime === null) {
                stableStartTime = Date.now();
            } else if (Date.now() - stableStartTime >= minStableTime) {
                // Been stable for minStableTime - safe to proceed
                return true;
            }
        } else {
            // Count changed - reset stability timer
            stableStartTime = null;
            lastCommentCount = currentCount;
        }
    }

    // Reached maxWait - return whether we achieved stability
    return stableStartTime !== null;
}

/**
 * Dismisses any popup blockers like the "Get Full Access" modal
 * @param {import("playwright").Page} page 
 */
async function dismissBlockers(page, logger = console) {
    try {
        // Check if we hit the "Oops! Something went wrong" error page
        const errorText = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            if (bodyText.includes("Oops! Something went wrong") && bodyText.includes("blindapp@teamblind.com")) {
                return true;
            }
            return false;
        });

        if (errorText) {
            logger.log("  🛑 Detected Blind Error Page (Rate Limit?).");
            return "rate_limited";
        }

        const blockerSelector = 'button.absolute.right-4.top-4';
        const closeBtn = await page.$(blockerSelector);
        if (closeBtn) {
            const isCloseBtn = await closeBtn.evaluate(el => el.querySelector('.sr-only')?.textContent?.includes('Close'));
            if (isCloseBtn) {
                logger.log("  ⚠️ Detected blocker modal. Dismissing...");
                await closeBtn.click({ force: true });
                await page.waitForTimeout(500);
                return "modal_dismissed";
            }
        }
    } catch (e) {
        // Ignore errors during blocker dismissal
    }
    return false;
}


async function extractPostData(page, url, logger = console, options = {}) {
    const { captureTopLevel: shouldCaptureTopLevel = false } = options;
    const scrapeTimeRaw = new Date();
    const scrapeTime = getFormattedScrapeTime();
    logger.log(`Processing (Optimized): ${url} at ${scrapeTime}`);

    // OPTIMIZATION: Check if already on the page (preserves Referer from organic scraper)
    if (page.url() !== url && page.url() !== url + "/") {
        // Reduced timeout to 20s to detect redirects/failures faster
        // We NO LONGER swallow this error. If navigation fails, we want the caller (startScraping) to know.
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000, referer: "https://www.teamblind.com/" });
    } else {
        logger.log("  ℹ Page already at target URL (Skipping navigation)");
    }

    // Wait for potential client-side redirect (common for missing posts)
    await page.waitForTimeout(3000);

    // CHECK: If redirected to home page, the post is likely missing/deleted
    // Use page.evaluate to get the true current URL if page.url() is stale
    const currentUrl = await page.evaluate(() => window.location.href).catch(() => page.url());

    if (currentUrl === "https://www.teamblind.com/" || currentUrl === "https://www.teamblind.com") {
        logger.log("  🛑 Redirected to home page (Post likely deleted/missing).");
        throw new Error("POST_NOT_FOUND_REDIRECT");
    }

    // NEW: Check for browser error pages (like "No internet")
    const pageTitle = await page.title();
    if (pageTitle === "No internet" || pageTitle.includes("not available") || pageTitle.includes("Problem loading page")) {
        logger.log(`  🛑 Detected browser error page: "${pageTitle}"`);
        throw new Error(`BROWSER_ERROR_PAGE: ${pageTitle}`);
    }

    // Check for "Oops" error page immediately after navigation
    const status = await dismissBlockers(page, logger);
    if (status === "rate_limited") {
        throw new Error("RATE_LIMITED");
    }

    // Wait for main content to appear
    await page.waitForSelector('h1', { timeout: 15000 });

    // OPTIMIZATION: Hide sticky overlays/banners that often block clicks
    if (!options.verbose) {
        await page.evaluate(() => {
            const selectors = [
                'section.sticky',
                'div.sticky',
                '[class*="sticky"]',
                '[class*="Overlay"]',
                '[class*="Modal"]',
                '#onetrust-banner-sdk' // Common cookie banner
            ];
            selectors.forEach(s => {
                const elements = document.querySelectorAll(s);
                elements.forEach(el => {
                    // Only hide if it's likely a bottom/top banner or overlay
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed' || style.position === 'sticky') {
                        el.style.display = 'none';
                    }
                });
            });
        });
    }

    if (options.verbose) {
        // Wait for hydration
        logger.log("  ℹ [Verbose] Waiting for hydration...");
        await page.waitForTimeout(5000);

        // DEBUG: Log ALL IDs containing 'comment-'
        const allIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[id]'))
                .map(el => el.id)
                .filter(id => id.includes('comment-'));
        });
        logger.log(`  🔍 [Verbose] Found ${allIds.length} IDs containing 'comment-'.`);
        if (allIds.some(id => id.includes('48433511'))) {
            logger.log(`  ✅ [Verbose] Found 48433511 in global ID dump!`);
        } else {
            logger.log(`  ❌ [Verbose] 48433511 NOT in global ID dump.`);
            // Log the IDs near 48427764
            const index764 = allIds.findIndex(id => id.includes('48427764'));
            if (index764 !== -1) {
                logger.log(`     Neighbors of 48427764: ${allIds.slice(index764 - 2, index764 + 3).join(', ')}`);
            }
        }
    }

    // Check for "Get Full Access" modal immediately
    await dismissBlockers(page);

    const attemptedIds = new Set();
    const threadResults = {};
    const topLevelResults = shouldCaptureTopLevel ? {} : null;
    const debug_info = {
        batch_clicks: 0,
        nested_clicks: 0,
        focused_thread_scrapes: 0,
        expansion_logs: []
    };
    const LOOP_LOAD_MORE_TIMEOUT = 2000;

    // Helper: capture new top-level comment groups from the DOM into topLevelResults
    const doCapture = async () => {
        if (!topLevelResults) return;
        const newGroups = await page.evaluate(({ knownGroupIds, scrapeTimeRaw, useVerbose }) => {
            const normalizeDateInternal = (dateStr) => {
                if (!dateStr) return "";
                const cleanStr = dateStr.trim().replace(/·/g, '').trim();
                const now = new Date(scrapeTimeRaw);
                const relMatch = cleanStr.match(/^(\d+)([dhms])$/);
                if (relMatch) {
                    const val = parseInt(relMatch[1], 10);
                    const unit = relMatch[2];
                    const d = new Date(now);
                    if (unit === 'd') d.setDate(d.getDate() - val);
                    else if (unit === 'h') d.setHours(d.getHours() - val);
                    else if (unit === 'm') d.setMinutes(d.getMinutes() - val);
                    return d.toISOString().split('T')[0];
                }
                if (cleanStr.includes(',')) {
                    const d = new Date(cleanStr);
                    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                }
                const mdMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
                if (mdMatch) {
                    const yr = now.getFullYear();
                    const d = new Date(`${mdMatch[1]} ${mdMatch[2]}, ${yr}`);
                    if (d > now) d.setFullYear(yr - 1);
                    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                }
                const fallback = new Date(cleanStr);
                return !isNaN(fallback.getTime()) ? fallback.toISOString().split('T')[0] : cleanStr;
            };

            const results = {};
            const debug_skips = [];
            const debug_found_target = [];

            if (useVerbose) {
                // Log if the target exists ANYWHERE
                const target = document.getElementById('comment-group-48433511') || document.getElementById('comment-48433511');
                if (target) {
                    debug_found_target.push(`Found 48433511: Tag=${target.tagName}, ID=${target.id}, ParentID=${target.parentElement?.id}, OffsetTop=${target.offsetTop}`);
                }
            }

            const groups = document.querySelectorAll('div[id^="comment-group-"]');
            for (const g of groups) {
                if (useVerbose && g.id.includes('48433511')) debug_found_target.push(`Selector found group 48433511. InnerText: ${g.innerText.substring(0, 50)}`);

                if (knownGroupIds.includes(g.id)) continue;

                if (g.innerText.includes("Flagged by the community")) {
                    results[g.id] = {
                        userName: "System",
                        company: "Blind",
                        date: "",
                        content: "Flagged by the community.",
                        likes: "0",
                        images: [],
                        commentId: g.id.replace('comment-group-', ''),
                        commentGroupId: g.id,
                        nestedCount: 0,
                        nested: [],
                        isFlagged: true
                    };
                    continue;
                }

                const rootComment = g.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                if (!rootComment) {
                    debug_skips.push(`${g.id}: No root comment div found`);
                    continue;
                }

                const header = rootComment.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                results[g.id] = {
                    userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "Anonymous",
                    company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                    date: normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || ""),
                    content: rootComment.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                    likes: rootComment.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                    images: Array.from(rootComment.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src),
                    commentId: rootComment.id,
                    commentGroupId: g.id,
                    nestedCount: 0,
                    nested: []
                };
            }
            return { results, debug_skips, debug_found_target };
        }, { knownGroupIds: Object.keys(topLevelResults), scrapeTimeRaw: scrapeTimeRaw.getTime(), useVerbose: options.verbose });

        if (newGroups.debug_found_target && newGroups.debug_found_target.length > 0) {
            newGroups.debug_found_target.forEach(msg => logger.log(`    🔍 DEBUG: ${msg}`));
        }

        if (newGroups.debug_skips && newGroups.debug_skips.length > 0) {
            newGroups.debug_skips.forEach(skip => logger.log(`    ⚠️ Skipped: ${skip}`));
        }

        const capturedResults = newGroups.results;
        const newCount = Object.keys(capturedResults).length;
        if (newCount > 0) {
            Object.keys(capturedResults).forEach(groupId => {
                logger.log(`    → Discovered group: ${groupId}`);
            });
            Object.assign(topLevelResults, capturedResults);
            logger.log(`  ✓ Captured ${newCount} new top-level comments (total: ${Object.keys(topLevelResults).length})`);
        }
    };

    // OPTIMIZATION 1: Exhaust "View more comments" with adaptive waiting
    logger.log("⚡ Loading all top-level comments (optimized)...");

    // Capture initial visible comments before any clicks (essential for virtualized lists)
    await doCapture();

    let loadMoreVisible = true;
    let loadMoreAttempts = 0;

    while (loadMoreVisible && loadMoreAttempts < 50) {
        try {
            // Broaden selector to catch variations and ensure it's not disabled/hidden
            const loaderSelector = [
                'button:has-text("View more comments"):not([disabled])',
                'button:has-text("Show more comments"):not([disabled])',
                'button:has-text("Load more comments"):not([disabled])',
                'a:has-text("View more comments")',
                'a:has-text("Show more comments")',
                'a:has-text("Load more comments")'
            ].join(', ');

            const loadMoreBtn = await page.waitForSelector(loaderSelector, { timeout: LOAD_MORE_TIMEOUT });

            if (loadMoreBtn) {
                const beforeCount = await page.$$eval('div[id^="comment-group-"]', els => els.length);
                const btnData = await loadMoreBtn.evaluate(b => ({
                    tag: b.tagName,
                    text: b.innerText.trim(),
                    disabled: b.disabled
                }));

                debug_info.batch_clicks++;
                logger.log(`  ⚡ Clicking ${btnData.tag} "${btnData.text}" (total so far: ${beforeCount})...`);

                // Scroll into view and click
                await loadMoreBtn.scrollIntoViewIfNeeded().catch(() => { });
                await loadMoreBtn.evaluate(b => b.click());

                // Check if clicking triggered a blocker
                const dismissed = await dismissBlockers(page, logger);
                if (dismissed) {
                    await loadMoreBtn.evaluate(b => b.click()).catch(() => { });
                }

                // OPTIMIZATION: Wait for DOM change instead of fixed timeout
                await waitForDOMStability(page, WAIT_AFTER_CLICK);

                const afterCount = await page.$$eval('div[id^="comment-group-"]', els => els.length);
                loadMoreAttempts++;
                logger.log(`  ✓ Loaded ${afterCount - beforeCount} more comments (total: ${afterCount})`);
                await doCapture();
            } else {
                logger.log("  ℹ Handle for 'View more comments' was null?");
                loadMoreVisible = false;
            }
        } catch (e) {
            if (!e.message.includes('Timeout')) {
                logger.log(`  ℹ Error finding 'View more comments': ${e.message}`);
            } else {
                logger.log(`  ℹ No more 'View more comments' buttons (or timeout)`);
            }
            loadMoreVisible = false;
        }
    }

    // Capture any comments already visible (covers posts with no "Load more" button)
    await doCapture();
    if (topLevelResults) {
        logger.log(`  ℹ Phase 1 complete: ${Object.keys(topLevelResults).length} top-level comments captured`);
    }

    let loopCount = 0;
    let progressMade = true;

    // OPTIMIZATION 2: Unified loop with faster navigation
    while (progressMade && loopCount < 150) {
        loopCount++;
        progressMade = false;

        // Re-check for top-level comments with shorter timeout
        let loadMoreVisible = true;
        let loadMoreAttempts = 0;
        while (loadMoreVisible && loadMoreAttempts < 50) {
            try {
                const loaderSelector = [
                    'button:has-text("View more comments"):not([disabled])',
                    'button:has-text("Show more comments"):not([disabled])',
                    'button:has-text("Load more comments"):not([disabled])',
                    'a:has-text("View more comments")',
                    'a:has-text("Show more comments")',
                    'a:has-text("Load more comments")'
                ].join(', ');

                await page.waitForSelector(loaderSelector, { timeout: LOOP_LOAD_MORE_TIMEOUT });
                const loadMoreBtn = await page.$(loaderSelector);

                if (loadMoreBtn) {
                    debug_info.batch_clicks++;
                    await loadMoreBtn.evaluate(b => b.click());
                    await dismissBlockers(page);
                    await waitForDOMStability(page, WAIT_AFTER_CLICK);
                    loadMoreAttempts++;
                    logger.log(`  [Loop ${loopCount}] Loaded more comments (${loadMoreAttempts})`);
                    progressMade = true;
                }
            } catch (e) {
                loadMoreVisible = false;
            }
        }

        // Find expansion triggers
        const buttons = await page.$$('button:has-text("more reply"), button:has-text("more replies"), a:has-text("more reply"), a:has-text("more replies"), button:has-text("Show more"), a:has-text("Show more")');

        for (const btn of buttons) {
            let btnInfo;
            try {
                btnInfo = await btn.evaluate(node => {
                    const group = node.closest('div[id^="comment-group-"]');
                    if (!group) return null;

                    // STRATEGY: Find the "Head of the Thread" (Real Parent)
                    // 1. If this group starts with a real ID, that's our anchor.
                    // 2. If it starts with a deleted placeholder, scan previous siblings until we find a real ID.
                    let current = group;
                    let realParentId = group.id;

                    while (current) {
                        const firstChildDiv = current.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                        if (firstChildDiv) {
                            realParentId = firstChildDiv.id;
                            break;
                        }
                        // Move to previous group sibling
                        current = current.previousElementSibling;
                        if (current && !current.id.startsWith('comment-group-')) break;
                    }

                    return {
                        id: realParentId,
                        text: node.innerText.trim(),
                        isLink: node.tagName === 'A' || !!node.getAttribute('href') || !!node.closest('a')
                    };
                });
            } catch (e) {
                continue;
            }

            if (!btnInfo) continue;

            const key = btnInfo.id ? `${btnInfo.id}-${btnInfo.text}` : btnInfo.text;
            if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) continue;

            const currentUrl = page.url();
            logger.log(`  ⚡ Expanding ${btnInfo.text} for ${btnInfo.id}...`);

            try {
                // Use JS click for nested replies too
                await btn.evaluate(b => b.click());
                await dismissBlockers(page);
                attemptedIds.add(key);

                // OPTIMIZATION: Shorter wait after click
                await page.waitForTimeout(WAIT_AFTER_CLICK);
            } catch (e) {
                logger.log(`    ✗ Failed to click ${key}: ${e.message}`);
                continue;
            }

            if (page.url() !== currentUrl) {
                logger.log(`    → Navigated to thread view`);

                try {
                    // OPTIMIZATION: Use domcontentloaded instead of networkidle
                    await page.waitForSelector('div[id^="comment-"]', { timeout: 8000 });
                } catch (e) {
                    logger.log("    ⚠ Thread page slow/blank, going back");
                    await page.goBack({ waitUntil: "domcontentloaded" });
                    await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
                    progressMade = true;
                    break;
                }

                const threadData = await page.evaluate(({ scrapeTimeRaw }) => {
                    const normalizeDateInternal = (dateStr) => {
                        if (!dateStr) return "";
                        const cleanStr = dateStr.trim().replace(/·/g, '').trim();
                        const now = new Date(scrapeTimeRaw);

                        const relMatch = cleanStr.match(/^(\d+)([dhms])$/);
                        if (relMatch) {
                            const val = parseInt(relMatch[1], 10);
                            const unit = relMatch[2];
                            const d = new Date(now);
                            if (unit === 'd') d.setDate(d.getDate() - val);
                            else if (unit === 'h') d.setHours(d.getHours() - val);
                            else if (unit === 'm') d.setMinutes(d.getMinutes() - val);
                            return d.toISOString().split('T')[0];
                        }

                        if (cleanStr.includes(',')) {
                            const d = new Date(cleanStr);
                            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                        }

                        const mdMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
                        if (mdMatch) {
                            const yr = now.getFullYear();
                            const d = new Date(`${mdMatch[1]} ${mdMatch[2]}, ${yr}`);
                            if (d > now) d.setFullYear(yr - 1);
                            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                        }
                        const fallback = new Date(cleanStr);
                        return !isNaN(fallback.getTime()) ? fallback.toISOString().split('T')[0] : cleanStr;
                    };

                    const extractRepliesRecursive = (rootElement) => {
                        if (!rootElement) return [];
                        let threadContainer = rootElement.querySelector('div[class*="pl-"]');
                        if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) {
                            threadContainer = rootElement.nextElementSibling;
                        }
                        if (!threadContainer) {
                            const parentSibling = rootElement.parentElement?.nextElementSibling;
                            if (parentSibling) {
                                if (parentSibling.className?.includes('pl-')) {
                                    threadContainer = parentSibling;
                                } else {
                                    threadContainer = parentSibling.querySelector('div[class*="pl-"]');
                                }
                            }
                        }
                        if (!threadContainer) return [];

                        const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                            let parent = el.parentElement;
                            while (parent && parent !== threadContainer) {
                                if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) {
                                    return false;
                                }
                                parent = parent.parentElement;
                            }
                            return true;
                        });

                        return replyElements.map(el => {
                            const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                            const rCompany = header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "";
                            const rUserName = header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "";
                            const rDate = header?.querySelector('span.text-gray-600')?.textContent?.trim() || "";
                            const rContent = el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "";
                            const rLikes = el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0";
                            const images = Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src);

                            const nestedReplies = extractRepliesRecursive(el);
                            return {
                                userName: rUserName,
                                company: rCompany,
                                date: normalizeDateInternal(rDate),
                                content: rContent,
                                likes: rLikes,
                                images,
                                commentId: el.id,
                                nestedCount: nestedReplies.length,
                                nested: nestedReplies
                            };
                        });
                    };

                    // NEW STRATEGY: Capture all root-level comments on this page
                    const allCommentDivs = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])'));
                    if (allCommentDivs.length === 0) return { id: null, replies: [] };

                    // Find context: what is the shared parent or anchor?
                    // On thread pages, the first few comments might be at a lower depth (context).
                    // We want to return all comments as siblings IF they are truly siblings.

                    const nodesWithDepth = allCommentDivs.map(el => {
                        let depth = 0;
                        let current = el;
                        while (current && current.tagName !== 'BODY') {
                            const match = current.className?.match(/pl-\[(\d+)px\]/);
                            if (match) { depth = parseInt(match[1], 10); break; }
                            current = current.parentElement;
                        }
                        return { el, depth };
                    });

                    const minDepth = Math.min(...nodesWithDepth.map(n => n.depth));
                    const rootNodes = nodesWithDepth.filter(n => n.depth === minDepth);

                    const results = rootNodes.map(node => {
                        const el = node.el;
                        const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                        const images = Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src);
                        const nestedReplies = extractRepliesRecursive(el);

                        return {
                            userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "Anonymous",
                            company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                            date: normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || ""),
                            content: el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                            likes: el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                            images,
                            commentId: el.id,
                            nestedCount: nestedReplies.length,
                            nested: nestedReplies
                        };
                    });

                    return { id: rootNodes[0].el.id, replies: results };
                }, { scrapeTimeRaw: scrapeTimeRaw.getTime() });

                if (threadData.id) {
                    logger.log(`    ✓ Scraped ${threadData.replies.length} replies for ${threadData.id}`);
                    debug_info.focused_thread_scrapes++;
                    threadResults[threadData.id] = threadData.replies;
                    // Also key by btn ID if it's a group ID
                    if (btnInfo.id && btnInfo.id.includes('group')) {
                        threadResults[btnInfo.id] = threadData.replies;
                    }
                } else if (btnInfo.id) {
                    debug_info.focused_thread_scrapes++;
                    threadResults[btnInfo.id] = threadData.replies;
                    threadResults[btnInfo.id.replace('-group', '')] = threadData.replies;
                }

                // OPTIMIZATION: Use domcontentloaded for faster back navigation
                await page.goBack({ waitUntil: "domcontentloaded" });

                try {
                    await page.waitForSelector('h1', { timeout: 8000 });
                } catch (e) {
                    logger.log("    ⚠ Failed to restore main post, reloading");
                    await page.reload({ waitUntil: "domcontentloaded" });
                }

                // OPTIMIZATION: Reduced wait after navigation
                await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
            }

            progressMade = true;
            break;
        }

        // Trigger lazy loading
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(300); // Reduced from 500ms
    }

    let isPollResultNotVisible = false;
    // Click "View Result" on poll if present
    try {
        const viewResultBtn = await page.$('button:has-text("View Result")');
        if (viewResultBtn) {
            const isDisabled = await viewResultBtn.evaluate(node => node.disabled);
            if (isDisabled) {
                logger.log("  ℹ Poll results hidden or no participants. Skipping click.");
                isPollResultNotVisible = true;
            } else {
                logger.log("⚡ Revealing poll results...");
                await viewResultBtn.click({ timeout: 5000 }).catch(e => {
                    logger.log(`  ⚠️ Failed to click poll: ${e.message}`);
                    isPollResultNotVisible = true;
                });
                if (!isPollResultNotVisible) {
                    await page.waitForTimeout(800);
                }
            }
        } else {
            // If there's no "View Result" button, it might be a poll we already voted on,
            // or it might not be a poll at all. We'll check for poll container in evaluate.
        }
    } catch (e) {
        // Error during poll check
        logger.log(`  ⚠️ Error checking poll: ${e.message}`);
    }

    const data = await page.evaluate(({ externalThreadResults, capturedTopLevelResults, scrapeTimeRaw, formattedScrapeTime, useVerbose, isPollResultNotVisible }) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";

        const title = getSafeText("h1");
        const content = getSafeText("p.whitespace-pre-wrap.break-words");

        // Find post images - look for images with the specific upload path that are NOT inside a comment
        const postImages = Array.from(document.querySelectorAll('img[src*="/uploads/atch_img/"]'))
            .filter(img => !img.closest('div[id^="comment-"]'))
            .map(img => img.src);


        const channel = getSafeText('a[data-testid="article-preview-channel"]');
        const rawDate = document.querySelector('a[data-testid="article-preview-channel"]')?.parentElement?.querySelector('span')?.textContent?.trim() || "";

        const normalizeDateInternal = (dateStr) => {
            if (!dateStr) return "";
            const cleanStr = dateStr.trim().replace(/·/g, '').trim();
            const now = new Date(scrapeTimeRaw);

            const relMatch = cleanStr.match(/^(\d+)([dhms])$/);
            if (relMatch) {
                const val = parseInt(relMatch[1], 10);
                const unit = relMatch[2];
                const d = new Date(now);
                if (unit === 'd') d.setDate(d.getDate() - val);
                else if (unit === 'h') d.setHours(d.getHours() - val);
                else if (unit === 'm') d.setMinutes(d.getMinutes() - val);
                return d.toISOString().split('T')[0];
            }

            if (cleanStr.includes(',')) {
                const d = new Date(cleanStr);
                if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
            }

            const mdMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
            if (mdMatch) {
                const yr = now.getFullYear();
                const d = new Date(`${mdMatch[1]} ${mdMatch[2]}, ${yr}`);
                if (d > now) d.setFullYear(yr - 1);
                if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
            }
            const fallback = new Date(cleanStr);
            return !isNaN(fallback.getTime()) ? fallback.toISOString().split('T')[0] : cleanStr;
        };

        const date = normalizeDateInternal(rawDate);

        let userCompany = "";
        let userName = "Anonymous";

        const opHeader = document.querySelector('.flex.h-full.items-center.text-xs.text-gray-800');
        if (opHeader) {
            const nodes = Array.from(opHeader.childNodes);
            if (nodes.length >= 3) {
                userCompany = nodes[0].textContent.trim();
                userName = nodes[2].textContent.trim();
            } else {
                const companyEl = opHeader.querySelector('a[href^="/company/"]');
                userCompany = companyEl?.textContent?.trim() || "";

                const textNodes = nodes
                    .filter(node => node.nodeType === 3)
                    .map(node => node.textContent.trim())
                    .filter(txt => txt.length > 1 && !txt.includes('·'));

                if (textNodes.length > 0) {
                    userName = textNodes[textNodes.length - 1];
                }
            }
        }

        if (userName === "Anonymous" && !userCompany) {
            const h1El = document.querySelector('h1');
            const possibleHeaders = Array.from(document.querySelectorAll('.flex.flex-wrap.text-xs.font-semibold.text-gray-700'));

            for (const header of possibleHeaders) {
                const headerRect = header.getBoundingClientRect();
                const h1Rect = h1El?.getBoundingClientRect();
                if (h1Rect && headerRect.top <= h1Rect.bottom + 50) {
                    const authorCompanyEl = header.querySelector('a[href^="/company/"]');
                    const authorNameEl = header.querySelector('span:not(.text-gray-600)');
                    if (authorCompanyEl || authorNameEl) {
                        userCompany = authorCompanyEl?.textContent?.trim() || "";
                        userName = authorNameEl?.textContent?.trim() || "Anonymous";
                        break;
                    }
                }
            }
        }

        const likes = (document.querySelector('button[aria-label="Like this post"]') || document.querySelector('.icon-like')?.parentElement)?.textContent?.trim() || "0";
        const views = document.querySelector('button[aria-label="Views"]')?.getAttribute('data-count') || "0";
        const commentsCount = (document.querySelector('button[aria-label="Comment on this post"]') || document.querySelector('.icon-comment')?.parentElement)?.textContent?.trim() || "0";

        let post_type = "regular_post";
        let pollContainer = null;

        const pollBadge = Array.from(document.querySelectorAll('span, div')).find(el =>
            (el.textContent === "Poll" && (el.classList.contains('text-red-600') || el.classList.contains('text-red-800'))) ||
            (el.textContent === "Offer" && (el.classList.contains('text-green') || el.classList.contains('text-green-800')))
        );

        if (pollBadge) {
            post_type = pollBadge.textContent.trim() === "Poll" ? "poll" : "offer";
            pollContainer = pollBadge.closest('div.rounded-lg.border') ||
                pollBadge.parentElement?.closest('div.rounded-lg.border') ||
                pollBadge.parentElement?.parentElement?.closest('div.rounded-lg.border');
        }

        if (!pollContainer) {
            const participantsText = Array.from(document.querySelectorAll('div, span')).find(el =>
                el.textContent?.includes('Participants') &&
                (el.querySelector('span.font-semibold') || el.classList.contains('font-semibold'))
            );
            if (participantsText) {
                pollContainer = participantsText.closest('div.rounded-lg.border');
                if (post_type === "regular_post") {
                    post_type = channel === "Offer Evaluation" ? "offer" : "poll";
                }
            }
        }

        let pollData = null;
        if (pollContainer) {
            const options = [];
            let participants = 0;
            const participantsMatch = pollContainer.textContent?.match(/([\d,]+)\s*Participants?/i);
            if (participantsMatch) {
                participants = parseInt(participantsMatch[1].replace(/,/g, ''), 10);
            }

            if (post_type === "poll") {
                let optionRows = Array.from(pollContainer.querySelectorAll('div.relative.mb-3, div.relative'));
                optionRows = optionRows.filter(row => row.textContent?.includes('%'));

                optionRows.forEach((row) => {
                    const label = row.querySelector('.flex-1.text-sm')?.textContent?.trim() ||
                        row.querySelector('label')?.textContent?.trim() ||
                        Array.from(row.childNodes).find(n => n.nodeType === 3)?.textContent?.trim() || "";

                    const resultText = row.querySelector('.text-xs.font-semibold')?.textContent?.trim() ||
                        row.querySelector('.font-semibold')?.textContent?.trim() || "";

                    const resultMatch = resultText.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);
                    if (label && resultMatch) {
                        options.push({
                            label,
                            percent: parseFloat(resultMatch[1]),
                            votes: parseInt(resultMatch[2], 10)
                        });
                    }
                });
            } else if (post_type === "offer") {
                const offerBlocks = pollContainer.querySelectorAll('div.flex.space-x-2.rounded-lg.border');
                offerBlocks.forEach((block) => {
                    const companyMatch = block.querySelector('label')?.textContent?.trim() || "Unknown";
                    const role = block.querySelector('.text-sm.font-semibold')?.textContent?.trim() || "";
                    const level = block.querySelector('.text-xs.text-gray-600')?.textContent?.trim() || "";

                    const extractField = (label) => {
                        const prefixNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim().startsWith(label) && el.children.length === 0
                        );
                        if (prefixNodes.length > 0) {
                            return prefixNodes[0].textContent.replace(label, '').trim();
                        }

                        const labelNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim() === label.replace(':', '').trim()
                        );
                        if (labelNodes.length > 0) {
                            const valueNode = labelNodes[0].previousElementSibling;
                            if (valueNode) return valueNode.textContent.trim();
                        }

                        return "";
                    };

                    const tcValue = extractField('TC:');
                    const baseValue = extractField('Base:');
                    const equityValue = extractField('Equity:');
                    const signOnValue = extractField('Sign-on:');
                    const bonusValue = extractField('Bonus:');

                    const resultText = block.querySelector('.text-xs.font-semibold')?.textContent?.trim() ||
                        block.querySelector('.font-semibold')?.textContent?.trim() || "";
                    const resultMatch = resultText.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);

                    options.push({
                        label: companyMatch,
                        role,
                        level,
                        tc: tcValue,
                        base: baseValue,
                        equity: equityValue,
                        signOn: signOnValue,
                        bonus: bonusValue,
                        percent: resultMatch ? parseFloat(resultMatch[1]) : 0,
                        votes: resultMatch ? parseInt(resultMatch[2], 10) : 0
                    });
                });
            }

            if (options.length > 0) {
                pollData = { post_type, participants, options };
                options.forEach((opt, i) => {
                    pollData[`option${i + 1}`] = opt.label;
                    pollData[`option${i + 1}_percent`] = opt.percent;
                    pollData[`option${i + 1}_votes`] = opt.votes;
                    if (opt.tc) pollData[`option${i + 1}_tc`] = opt.tc;
                });
            }
        }

        const relatedSection = Array.from(document.querySelectorAll('div')).find(d => d.textContent === 'Related Companies')?.parentElement;
        const relatedCompanies = Array.from(relatedSection?.querySelectorAll('a[href^="/company/"]') || []).map(a => ({
            name: a.querySelector('h4')?.textContent?.trim() || "",
            rating: a.querySelector('span.text-sm.font-semibold')?.textContent?.trim() || ""
        }));

        const topicsSection = Array.from(document.querySelectorAll('div, h3')).find(el => el.textContent === 'Related Companies Topics')?.parentElement;
        const relatedTopics = Array.from(topicsSection?.querySelectorAll('div.pb-2.pt-2') || []).map(group => {
            const companyName = group.querySelector('h4')?.textContent?.trim() || "";
            const links = Array.from(group.querySelectorAll('a.underline')).map(a => ({ label: a.textContent.trim(), url: a.href }));
            return { companyName, links };
        });

        const buildUniversalTree = (rootCommentGroups) => {
            if (!rootCommentGroups || rootCommentGroups.length === 0) return [];

            const allNodesInStream = [];

            rootCommentGroups.forEach(groupElement => {
                const allDivs = Array.from(groupElement.querySelectorAll('div'));
                const relevantNodes = allDivs.filter(el => {
                    if (el.id && el.id.startsWith('comment-') && !el.id.startsWith('comment-group-')) return true;
                    if (el.children.length === 0 && /Flagged by the community|Deleted/i.test(el.innerText)) return true;
                    return false;
                });

                // STRATEGY: Find the logical head for this group
                let currentHeadId = groupElement.id;
                let scanBack = groupElement;
                while (scanBack) {
                    const headComment = scanBack.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                    if (headComment) {
                        currentHeadId = headComment.id;
                        break;
                    }
                    scanBack = scanBack.previousElementSibling;
                    if (scanBack && !scanBack.id.startsWith('comment-group-')) break;
                }

                relevantNodes.forEach(el => {
                    let depth = 0;
                    let current = el;
                    // Try class-based depth first, then visual left-offset
                    while (current && current.tagName !== 'BODY') {
                        const match = current.className?.match(/pl-\[(\d+)px\]/);
                        if (match) {
                            depth = parseInt(match[1], 10);
                            break;
                        }
                        current = current.parentElement;
                    }
                    if (depth === 0) {
                        depth = Math.floor(el.getBoundingClientRect().left / 10); // Fallback to visual left
                    }

                    const isRegular = el.id && el.id.startsWith('comment-');
                    const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                    const images = isRegular ? Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src) : [];

                    allNodesInStream.push({
                        depth,
                        offsetTop: el.getBoundingClientRect().top + window.scrollY,
                        headId: currentHeadId,
                        data: {
                            userName: isRegular ? (header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "Anonymous") : "System",
                            company: isRegular ? (header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "") : "Blind",
                            date: isRegular ? normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || "") : "",
                            content: isRegular ? (el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "") : (el.innerText.trim() || "Flagged by the community."),
                            likes: isRegular ? (el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0") : "0",
                            images,
                            commentId: isRegular ? el.id : (groupElement.id.replace('comment-group-', '') + "-flagged-" + Math.floor(el.getBoundingClientRect().top)),
                            commentGroupId: groupElement.id,
                            nestedCount: 0,
                            nested: [],
                            isFlagged: !isRegular
                        }
                    });
                });
            });

            // Sort all nodes globally by vertical position
            allNodesInStream.sort((a, b) => a.offsetTop - b.offsetTop);

            const tree = [];
            const stack = [];
            let skipUntilDepth = -1;

            allNodesInStream.forEach(item => {
                if (skipUntilDepth !== -1 && item.depth > skipUntilDepth) return;
                skipUntilDepth = -1;

                while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
                    stack.pop();
                }

                // Expansion injection with logical Head-ID support
                const external = externalThreadResults[item.data.commentId] ||
                    externalThreadResults[item.data.commentGroupId] ||
                    externalThreadResults[item.headId];

                if (external && external.length > 0) {
                    // BOOT-REMOVAL: If the first result is just a duplicate of the parent (anchor), strip it
                    // but keep its children and any other siblings found on the thread page.
                    const duplication = external.find(ext => ext.commentId === item.data.commentId);
                    if (duplication) {
                        const otherSiblings = external.filter(ext => ext.commentId !== item.data.commentId);
                        item.data.nested = [...(duplication.nested || []), ...otherSiblings];
                    } else {
                        item.data.nested = external;
                    }
                    skipUntilDepth = item.depth;
                }

                if (stack.length === 0) {
                    tree.push(item.data);
                } else {
                    stack[stack.length - 1].data.nested.push(item.data);
                }
                stack.push(item);
            });

            return tree;
        };

        const rootCommentGroups = Array.from(document.querySelectorAll('div[id^="comment-group-"]')).filter(group => {
            return !group.parentElement.closest('div[class*="pl-"]');
        });

        const replies = buildUniversalTree(rootCommentGroups);

        // Merge any top-level comments captured incrementally but no longer in the DOM
        let rescuedCount = 0;
        if (capturedTopLevelResults && Object.keys(capturedTopLevelResults).length > 0) {
            const domGroupIds = new Set(rootCommentGroups.map(g => g.id));
            for (const [groupId, capturedComment] of Object.entries(capturedTopLevelResults)) {
                if (!domGroupIds.has(groupId)) {
                    replies.push(capturedComment);
                    rescuedCount++;
                }
            }
        }

        // Calculate actual scraped count locally
        const countRecursive = (list) => {
            let count = 0;
            for (const item of list) {
                count++;
                if (item.nested && item.nested.length > 0) {
                    count += countRecursive(item.nested);
                }
            }
            return count;
        };
        const scrapedCommentsCount = countRecursive(replies);

        // Count deleted/flagged comments
        const countFlagged = (list) => {
            let count = 0;
            for (const item of list) {
                if (item.isFlagged) count++;
                if (item.nested && item.nested.length > 0) {
                    count += countFlagged(item.nested);
                }
            }
            return count;
        };
        const deletedCommentsCount = countFlagged(replies);

        // Annotate each comment with nestedCount (total nested replies, recursive)
        const annotateNestedCount = (list) => {
            for (const item of list) {
                if (item.nested && item.nested.length > 0) {
                    annotateNestedCount(item.nested);
                    item.nestedCount = countRecursive(item.nested);
                } else {
                    item.nestedCount = 0;
                }
            }
        };
        annotateNestedCount(replies);

        // Collect all IDs for debug dictionary
        const allCommentIds = [];
        const collectIds = (list) => {
            for (const item of list) {
                allCommentIds.push({
                    commentId: item.commentId,
                    commentGroupId: item.commentGroupId
                });
                if (item.nested && item.nested.length > 0) {
                    collectIds(item.nested);
                }
            }
        };
        collectIds(replies);

        return {
            scrapeTime: formattedScrapeTime,
            post_type: pollData?.post_type || "regular_post",
            title, content, userName, userCompany, date, channel, likes, views, commentsCount,
            scrapedCommentsCount,
            deletedCommentsCount, // Count of isFlagged comments in the tree
            images: postImages,
            poll: isPollResultNotVisible ? null : pollData,
            relatedCompanies, relatedTopics, replies,
            rescuedCount,
            debug: useVerbose ? debug_info : undefined,
            isPollResultNotVisible: pollContainer ? isPollResultNotVisible : undefined,
            debug_mappings: allCommentIds
        };
    }, { externalThreadResults: threadResults, capturedTopLevelResults: topLevelResults, scrapeTimeRaw: scrapeTimeRaw.getTime(), formattedScrapeTime: scrapeTime, useVerbose: options.verbose, isPollResultNotVisible });

    data.debug = {
        ...data.debug,
        ...debug_info,
        all_comment_ids: data.debug_mappings
    };
    delete data.debug_mappings;

    // Log rescued comments if any
    if (data.rescuedCount > 0) {
        logger.log(`  ✓ Rescued ${data.rescuedCount} top-level comments from incremental capture (total: ${data.replies.length})`);
        // Recalculate scraped count after rescue
        const countAll = (list) => { let c = 0; for (const item of list) { c++; if (item.nested?.length) c += countAll(item.nested); } return c; };
        data.scrapedCommentsCount = countAll(data.replies);
    }
    delete data.rescuedCount;

    return { url, ...data };
}

async function startScraping() {
    const usePersistentContext = process.argv.includes('--persistent');
    const useHeadless = false;
    const useCaptureTopLevel = !process.argv.includes('--no-capture-toplevel');
    const useNewBrowser = process.argv.includes('--new-browser');
    const useVerbose = process.argv.includes('--verbose');
    const useLogin = process.argv.includes('--login');
    const useManualLogin = process.argv.includes('--manual-login');
    const useLoginWait = process.argv.includes('--login-wait');
    const useAutoLogin = !useLogin && !useManualLogin && !useLoginWait; // default on
    const useReverse = process.argv.includes('--reverse');
    const usePrevRetry = process.argv.includes('--prev-retry');

    if (accArgIndex === -1) {
        console.error('❌ --account <number> is required. E.g. --account 1');
        process.exit(1);
    }

    let companies = [];
    if (COMPANY_LIST_PATH && fs.existsSync(COMPANY_LIST_PATH)) {
        console.log(`📋 Loading companies from ${COMPANY_LIST_PATH}...`);
        companies = JSON.parse(fs.readFileSync(COMPANY_LIST_PATH, "utf-8"));
    } else {
        companies = [{ "Company Name": "Single", "Symbol": "SINGLE", "is_single": true }];
    }

    if (useReverse) {
        console.log("🔄 Reverse mode active: Processing URLs from tail to head");
        companies.reverse();
    }

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

    let browser, context;

    async function launchBrowserInstance() {
        let b, ctx;
        if (usePersistentContext) {
            const accArgIndex = process.argv.indexOf('--account');
            const profileSuffix = (accArgIndex !== -1 && process.argv[accArgIndex + 1]) ? `_${process.argv[accArgIndex + 1]}` : "";
            const userDataDir = path.resolve(__dirname, `../../browser_profile${profileSuffix}`);

            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            console.log(`📂 Using persistent browser profile at: ${userDataDir}`);
            ctx = await chromium.launchPersistentContext(userDataDir, {
                headless: useHeadless,
                channel: 'chrome',
                proxy: proxyConfig,
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
        } else {
            b = await chromium.launch({ headless: useHeadless, proxy: proxyConfig });
            ctx = await b.newContext();
        }

        // OPTIMIZATION: Block unnecessary resources to speed up page loads
        // Bypassed if login is active to ensure CAPTCHAs and other assets load
        if (!useLogin && !useManualLogin && !useLoginWait && !useAutoLogin) {
            await ctx.route('**/*', (route) => {
                const url = route.request().url();
                if (url.includes('google-analytics') ||
                    url.includes('googletagmanager') ||
                    url.includes('facebook.com/tr') ||
                    url.includes('.woff') ||
                    url.includes('.woff2')) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
        }

        const pages = ctx.pages();
        const pg = pages.length > 0 ? pages[0] : await ctx.newPage();
        return { browser: b, context: ctx, page: pg };
    }

    let page;
    ({ browser, context, page } = await launchBrowserInstance());

    if (useLogin || useManualLogin || useLoginWait || useAutoLogin) {
        await login(page, {
            manual: useManualLogin,
            waitOnly: useLoginWait,
            automatic: useAutoLogin,
            semiAuto: useLogin && !useAutoLogin
        });
    } else {
        console.log("Skipping login as per configuration. Some content (polls, etc.) may be missing.");
    }

    for (const company of companies) {
        let urls = [];
        let currentOutDir = DEFAULT_OUT_DIR;
        let companyName = company["Company Name"];

        if (company.is_single) {
            if (IN_FILE && IN_FILE.startsWith("http")) {
                urls = [IN_FILE];
                console.log(`⚡ Starting OPTIMIZED single post extraction for: ${IN_FILE}`);
            } else if (IN_FILE && fs.existsSync(IN_FILE)) {
                if (IN_FILE.endsWith('.json')) {
                    const data = JSON.parse(fs.readFileSync(IN_FILE, "utf-8"));
                    urls = data.map(item => item.url || item.PostURL || item).filter(u => u && typeof u === 'string');
                } else {
                    urls = fs.readFileSync(IN_FILE, "utf-8").split("\n").filter(u => u.trim());
                }
            }
        } else {
            // Batch company mode: compute IN_FILE and OUT_DIR
            const safeName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
            const companyBaseDir = path.resolve(__dirname, "../../data/company_post_urls", safeName);
            const batchInFile = path.join(companyBaseDir, `${safeName}_recent.json`);
            currentOutDir = path.resolve(__dirname, "../../data/company_posts", safeName);

            const tagsDir = path.join(companyBaseDir, "tags");
            const SKIP_FILES = ["state.json"];

            console.log(`\n🏢 Processing Company: ${companyName} (${company.Symbol})`);
            const urlSet = new Set();
            let anyFileFound = false;

            // Scan ALL json files in root dir (excluding duplicates and non-URL files)
            if (fs.existsSync(companyBaseDir)) {
                const rootFiles = fs.readdirSync(companyBaseDir)
                    .filter(f => f.endsWith(".json") && !f.includes("_duplicates") && !SKIP_FILES.includes(f));
                for (const rf of rootFiles) {
                    try {
                        const data = JSON.parse(fs.readFileSync(path.join(companyBaseDir, rf), "utf-8"));
                        const fileUrls = data.map(item => item.url).filter(u => u);
                        if (fileUrls.length === 0) continue;
                        const before = urlSet.size;
                        fileUrls.forEach(u => urlSet.add(u));
                        console.log(`   🔗 Loaded ${fileUrls.length} URLs from ${rf} (${urlSet.size - before} new)`);
                        anyFileFound = true;
                    } catch { }
                }
            }

            // Also scan tags/ subdirectory
            if (fs.existsSync(tagsDir)) {
                const tagFiles = fs.readdirSync(tagsDir).filter(f => f.endsWith(".json") && !f.includes("_duplicates"));
                for (const tf of tagFiles) {
                    try {
                        const data = JSON.parse(fs.readFileSync(path.join(tagsDir, tf), "utf-8"));
                        const fileUrls = data.map(item => item.url).filter(u => u);
                        if (fileUrls.length === 0) continue;
                        const before = urlSet.size;
                        fileUrls.forEach(u => urlSet.add(u));
                        console.log(`   🔗 Loaded ${fileUrls.length} URLs from tags/${tf} (${urlSet.size - before} new)`);
                        anyFileFound = true;
                    } catch { }
                }
            }

            if (!anyFileFound) {
                console.warn(`   ⚠️ No URL files found in ${companyBaseDir}. Skipping.`);
                continue;
            }
            urls = Array.from(urlSet);
        }

        if (useReverse) {
            urls.reverse();
        }

        if (!fs.existsSync(currentOutDir)) {
            fs.mkdirSync(currentOutDir, { recursive: true });
        }

        const LOG_DIR = path.join(currentOutDir, "logs");
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        const allData = [];
        for (const url of urls) {
            const identifier = url.split('/').pop() || `post_${Date.now()}`;
            const filePath = `${currentOutDir}/${identifier}.json`;

            if (fs.existsSync(filePath)) {
                console.log(`⏭️ Skipping ${url} - already exists`);
                continue;
            }

            // In new-browser mode, launch a fresh browser for each URL
            // Bypassed if useLogin, useManualLogin or useLoginWait is true to maintain authenticated session
            if (useNewBrowser && !useLogin && !useManualLogin && !useLoginWait && urls.indexOf(url) > 0) {
                console.log(`🔄 Launching new browser for: ${identifier}`);
                if (browser) await browser.close().catch(() => { });
                else await context.close().catch(() => { });
                ({ browser, context, page } = await launchBrowserInstance());
            }

            let retryCount = 0;
            const maxRetries = usePrevRetry ? 3 : 9;
            const retryInterval = 10000; // Only used for granular
            let success = false;

            while (retryCount <= maxRetries && !success) {
                try {
                    const startTime = Date.now();

                    // Initialize per-post logger for standalone run
                    const logFile = path.join(LOG_DIR, `${identifier}.log`);
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

                    const options = {
                        captureTopLevel: useCaptureTopLevel,
                        verbose: useVerbose
                    };

                    const data = await extractPostData(page, url, logger, options);
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    data.time_elapsed = elapsed;

                    // identifier and filePath are already defined in the outer scope

                    // Pass the currentOutDir to downloadAllImages
                    await downloadAllImages(data, url, logger, currentOutDir);

                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                    console.log(`✅ Saved: ${filePath} (${elapsed}s, ${data.replies.length} top-level comments)`);

                    allData.push(data);
                    success = true;
                } catch (e) {
                    const errorMessage = e.message || String(e);
                    const isRetryable = errorMessage === "RATE_LIMITED" ||
                        errorMessage.includes("Timeout") ||
                        errorMessage.includes("BROWSER_ERROR_PAGE") ||
                        errorMessage.includes("net::ERR_");

                    if (isRetryable) {
                        retryCount++;
                        const accumulatedWait = (retryCount * retryInterval) / 1000;

                        if (retryCount > maxRetries) {
                            console.error(`❌ Permanent failure for ${url} after ${maxRetries} retries. Saving to failure list.`);
                            const failedFile = path.join(currentOutDir, "failed_post_urls.txt");
                            fs.appendFileSync(failedFile, `${url}\n`);
                            break;
                        }

                        console.log(`⚠️ ${errorMessage.includes("RATE_LIMITED") ? "Rate limited" : "Network/Browser error"}. Retry ${retryCount}/${maxRetries} (${accumulatedWait}s/90s)...`);
                        if (errorMessage.includes("net::ERR_")) {
                            console.log(`   ℹ Detail: ${errorMessage}`);
                        }

                        if (errorMessage === "RATE_LIMITED") {
                            console.log(`   🧊 Rate limit detected. Running 30s deep breath cooler...`);
                            await page.waitForTimeout(30000);
                            // If rate limited, try to "unstick" by going to home page
                            await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" }).catch(() => { });
                        }

                        await page.waitForTimeout(retryInterval);
                    } else if (errorMessage === "POST_NOT_FOUND_REDIRECT") {
                        console.error(`❌ Post not found (redirected to home): ${url}`);
                        const missingFile = path.join(currentOutDir, "missing_posts.txt");
                        fs.appendFileSync(missingFile, `${url}\n`);
                        break; // Non-retryable
                    } else {
                        console.error(`❌ Error scraping ${url}:`, errorMessage);
                        break; // Non-retryable error
                    }
                }
            }

            if (!success) {
                console.error(`❌ Permanent failure for ${url} after ${maxRetries} retries.`);
            }

            // Adaptive delay between posts with --delay and --jitter support
            const delayArgIdx = process.argv.indexOf('--delay');
            const jitterArgIdx = process.argv.indexOf('--jitter');

            const baseDelayMs = delayArgIdx !== -1 ? parseInt(process.argv[delayArgIdx + 1], 10) : 8000;
            const jitterMultiplier = jitterArgIdx !== -1 ? parseFloat(process.argv[jitterArgIdx + 1]) : 0.75;

            const delay = baseDelayMs + Math.floor(Math.random() * (baseDelayMs * jitterMultiplier));
            console.log(`⏳ Cooldown: Waiting ${Math.round(delay / 1000)}s before next post to avoid rate limits...`);
            await page.waitForTimeout(delay);
        } // End URL loop
    } // End Company loop

    if (browser) await browser.close();
    else if (context) await context.close();
    console.log("✅ Scraping completed.");
}

export { extractPostData, startScraping, dismissBlockers, downloadAllImages, login };

const isMain = process.argv[1].endsWith('extract_post_details.mjs');
if (isMain) {
    startScraping().catch(console.error);
}
