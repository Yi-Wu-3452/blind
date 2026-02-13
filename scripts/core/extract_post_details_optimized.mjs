import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = process.argv[2] && fs.existsSync(process.argv[2])
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, "../../data/nvidia_post_urls.txt");
const OUT_DIR = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(__dirname, "../../data/posts_optimized");
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

const SHOULD_LOGIN = !process.argv.includes('--persistent');

// OPTIMIZATION: Balanced wait times - faster but still robust
const WAIT_AFTER_CLICK = 1000; // Balanced: fast but ensures comments load
const WAIT_AFTER_NAVIGATION = 1200; // Balanced: ensures page restores properly
const LOAD_MORE_TIMEOUT = 5000; // Balanced: gives enough time for slow loads

// Organic Navigation Constants
const COMPANY_POSTS_URL = "https://www.teamblind.com/company/T-Mobile/posts";
const BASE_REFERER = "https://www.teamblind.com/company/T-Mobile/";

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

async function login(page) {
    console.log("Attempting auto-login...");
    await page.goto("https://www.teamblind.com/login", { waitUntil: "networkidle" });

    // Increased timeout and made it more robust
    await page.waitForSelector('input[name="email"]', { timeout: 15000 });
    await page.fill('input[name="email"]', CREDENTIALS.email);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');

    console.log("Login form submitted. Waiting for redirection...");

    // Wait for the URL to change from login or sign-in
    await page.waitForFunction(() => {
        const url = window.location.href;
        return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
    }, { timeout: 30000 });

    console.log("Auto-login successful. Proceeding to scrape...");
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

async function downloadAllImages(data, postUrl) {
    const imagesDir = path.resolve(__dirname, "../../data/images");
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
                console.log(`  Downloaded: ${localFilename}`);
            }
            targetArray.push(localFilename);
        } catch (e) {
            console.error(`  Failed to download ${url}: ${e.message}`);
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
async function dismissBlockers(page) {
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
            console.log("  🛑 Detected Blind Error Page (Rate Limit?).");
            return "rate_limited";
        }

        const blockerSelector = 'button.absolute.right-4.top-4';
        const closeBtn = await page.$(blockerSelector);
        if (closeBtn) {
            const isCloseBtn = await closeBtn.evaluate(el => el.querySelector('.sr-only')?.textContent?.includes('Close'));
            if (isCloseBtn) {
                console.log("  ⚠️ Detected blocker modal. Dismissing...");
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


async function extractPostData(page, url) {
    const scrapeTimeRaw = new Date();
    const scrapeTime = getFormattedScrapeTime();
    console.log(`Processing (Optimized): ${url} at ${scrapeTime}`);

    // OPTIMIZATION: Use domcontentloaded instead of networkidle for faster initial load
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Check for "Oops" error page immediately after navigation
    const status = await dismissBlockers(page);
    if (status === "rate_limited") {
        throw new Error("RATE_LIMITED");
    }

    // Wait for main content to appear
    await page.waitForSelector('h1', { timeout: 15000 });

    // OPTIMIZATION: Hide sticky overlays/banners that often block clicks
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

    // Check for "Get Full Access" modal immediately
    await dismissBlockers(page);

    const attemptedIds = new Set();
    const threadResults = {};
    const debug_info = {
        batch_clicks: 0,
        nested_clicks: 0,
        focused_thread_scrapes: 0,
        expansion_logs: []
    };

    // OPTIMIZATION 1: Exhaust "View more comments" with adaptive waiting
    console.log("⚡ Loading all top-level comments (optimized)...");
    let loadMoreVisible = true;
    let loadMoreAttempts = 0;

    while (loadMoreVisible && loadMoreAttempts < 50) {
        try {
            await page.waitForSelector('button:has-text("View more comments")', { timeout: LOAD_MORE_TIMEOUT });
            const loadMoreBtn = await page.$('button:has-text("View more comments")');

            if (loadMoreBtn) {
                const beforeCount = await page.$$eval('div[id^="comment-"]', els => els.length);
                debug_info.batch_clicks++;
                // Use JS click to bypass pointer interception from overlays
                await loadMoreBtn.evaluate(b => b.click());

                // Check if clicking triggered a blocker
                const dismissed = await dismissBlockers(page);
                if (dismissed) {
                    // Try clicking again if it was blocked
                    await loadMoreBtn.evaluate(b => b.click()).catch(() => { });
                }

                // OPTIMIZATION: Wait for DOM change instead of fixed timeout
                await waitForDOMStability(page, WAIT_AFTER_CLICK);

                const afterCount = await page.$$eval('div[id^="comment-"]', els => els.length);
                loadMoreAttempts++;
                console.log(`  ✓ Loaded ${afterCount - beforeCount} more comments (total: ${afterCount})`);
            } else {
                loadMoreVisible = false;
            }
        } catch (e) {
            console.log(`  ℹ No more 'View more comments' buttons`);
            loadMoreVisible = false;
        }
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
        const LOOP_LOAD_MORE_TIMEOUT = 2000; // Reduced from 5000ms

        while (loadMoreVisible && loadMoreAttempts < 50) {
            try {
                await page.waitForSelector('button:has-text("View more comments")', { timeout: LOOP_LOAD_MORE_TIMEOUT });
                const loadMoreBtn = await page.$('button:has-text("View more comments")');

                if (loadMoreBtn) {
                    debug_info.batch_clicks++;
                    await loadMoreBtn.evaluate(b => b.click());
                    await dismissBlockers(page);
                    await waitForDOMStability(page, WAIT_AFTER_CLICK);
                    loadMoreAttempts++;
                    console.log(`  [Loop ${loopCount}] Loaded more comments (${loadMoreAttempts})`);
                    progressMade = true;
                } else {
                    loadMoreVisible = false;
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
                    const comment = node.closest('div[id^="comment-"]');
                    return {
                        id: comment ? comment.id : null,
                        text: node.innerText.trim(),
                        isLink: node.tagName === 'A' || !!node.getAttribute('href') || !!node.closest('a')
                    };
                });
            } catch (e) {
                continue;
            }

            const key = btnInfo.id ? `${btnInfo.id}-${btnInfo.text}` : btnInfo.text;
            if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) continue;

            const currentUrl = page.url();
            console.log(`  ⚡ Expanding ${key}...`);

            try {
                // Use JS click for nested replies too
                await btn.evaluate(b => b.click());
                await dismissBlockers(page);
                attemptedIds.add(key);

                // OPTIMIZATION: Shorter wait after click
                await page.waitForTimeout(WAIT_AFTER_CLICK);
            } catch (e) {
                console.log(`    ✗ Failed to click ${key}: ${e.message}`);
                continue;
            }

            if (page.url() !== currentUrl) {
                console.log(`    → Navigated to thread view`);

                try {
                    // OPTIMIZATION: Use domcontentloaded instead of networkidle
                    await page.waitForSelector('div[id^="comment-"]', { timeout: 8000 });
                } catch (e) {
                    console.log("    ⚠ Thread page slow/blank, going back");
                    await page.goBack({ waitUntil: "domcontentloaded" });
                    await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
                    progressMade = true;
                    break;
                }

                const threadData = await page.evaluate(({ scrapeTimeRaw }) => {
                    const rootComment = document.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                    const actualId = rootComment ? rootComment.id : null;

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

                            return {
                                userName: rUserName,
                                company: rCompany,
                                date: normalizeDateInternal(rDate),
                                content: rContent,
                                likes: rLikes,
                                images,
                                commentId: el.id,
                                nested: extractRepliesRecursive(el)
                            };
                        });
                    };
                    return { id: actualId, replies: rootComment ? extractRepliesRecursive(rootComment) : [] };
                }, { scrapeTimeRaw: scrapeTimeRaw.getTime() });

                if (threadData.id) {
                    console.log(`    ✓ Scraped ${threadData.replies.length} replies for ${threadData.id}`);
                    debug_info.focused_thread_scrapes++;
                    threadResults[threadData.id] = threadData.replies;
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
                    console.log("    ⚠ Failed to restore main post, reloading");
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

    // Click "View Result" on poll if present
    try {
        const viewResultBtn = await page.$('button:has-text("View Result")');
        if (viewResultBtn) {
            console.log("⚡ Revealing poll results...");
            await viewResultBtn.click();
            await page.waitForTimeout(800);
        }
    } catch (e) {
        // Poll might not exist
    }

    const data = await page.evaluate(({ externalThreadResults, scrapeTimeRaw, formattedScrapeTime }) => {
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

        const extractReplies = (rootElement) => {
            const commentId = rootElement.id;
            if (commentId && externalThreadResults[commentId]) {
                return externalThreadResults[commentId];
            }

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

                return {
                    userName: rUserName,
                    company: rCompany,
                    date: normalizeDateInternal(rDate),
                    content: rContent,
                    likes: rLikes,
                    images,
                    commentId: el.id,
                    nested: extractReplies(el)
                };
            });
        };

        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
            return !el.parentElement.closest('div[class*="pl-"]');
        });

        const allCommentsPreFilter = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])'));
        const all_ids = allCommentsPreFilter.map(el => el.id);

        const replies = rootCommentElements.map(el => {
            const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
            const rCompany = header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "";
            const rUserName = header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "";
            const rDate = header?.querySelector('span.text-gray-600')?.textContent?.trim() || "";
            const rContent = el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "";
            const rLikes = el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0";
            const images = Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src);

            const commentId = el.id;
            let nestedReplies = extractReplies(el);

            let visibleCount = nestedReplies.length;
            let buttonCount = 0;
            // Search for moreBtn inside el OR in its sibling container
            const findMoreBtn = (root) => Array.from(root.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));
            let moreBtn = findMoreBtn(el);
            if (!moreBtn) {
                let threadContainer = el.querySelector('div[class*="pl-"]');
                if (!threadContainer && el.nextElementSibling?.className?.includes('pl-')) threadContainer = el.nextElementSibling;
                if (!threadContainer) {
                    const parentSibling = el.parentElement?.nextElementSibling;
                    if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
                }
                if (threadContainer) {
                    moreBtn = findMoreBtn(threadContainer);
                }
            }

            if (moreBtn) {
                const match = moreBtn.innerText.match(/(\d+)/);
                if (match) {
                    buttonCount = parseInt(match[1], 10);
                }
            }
            const expectedNestedCount = visibleCount + buttonCount;

            if ((!nestedReplies || nestedReplies.length === 0) && commentId && externalThreadResults[commentId]) {
                nestedReplies = externalThreadResults[commentId];
            }

            return {
                userName: rUserName,
                company: rCompany,
                date: normalizeDateInternal(rDate),
                content: rContent,
                likes: rLikes,
                images,
                commentId: el.id,
                nested: nestedReplies,
                expectedNestedCount
            };
        });

        return {
            scrapeTime: formattedScrapeTime,
            post_type: pollData?.post_type || "regular_post",
            title, content, userName, userCompany, date, channel, likes, views, commentsCount,
            images: postImages,
            poll: pollData,
            relatedCompanies, relatedTopics, replies,
            debug: {
                total_raw_comments: allCommentsPreFilter.length,
                all_comment_ids: all_ids
            }
        };
    }, { externalThreadResults: threadResults, scrapeTimeRaw: scrapeTimeRaw.getTime(), formattedScrapeTime: scrapeTime });

    data.debug = { ...data.debug, ...debug_info };

    return { url, ...data };
}

async function startScraping() {
    const argUrl = process.argv[2];
    let urls = [];

    if (argUrl && argUrl.startsWith("http")) {
        urls = [argUrl];
        console.log(`⚡ Starting OPTIMIZED single post extraction for: ${argUrl}`);
    } else {
        console.log(`⚡ Input file: ${IN_FILE}`);
        console.log(`⚡ Output dir: ${OUT_DIR}`);
        if (fs.existsSync(IN_FILE)) {
            urls = fs.readFileSync(IN_FILE, "utf-8").split("\n").filter(u => u.trim());
            console.log(`⚡ Starting OPTIMIZED batch extraction: ${urls.length} URLs found`);
        } else {
            console.error(`Input file not found: ${IN_FILE}`);
            process.exit(1);
        }
    }


    const usePersistentContext = process.argv.includes('--persistent');
    let browser, context;

    if (usePersistentContext) {
        const userDataDir = path.resolve(__dirname, "../../browser_profile");
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        console.log(`Using persistent browser profile at: ${userDataDir}`);

        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: 'chrome',
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
        browser = await chromium.launch({ headless: false });
        context = await browser.newContext();
    }

    // OPTIMIZATION: Block unnecessary resources to speed up page loads
    await context.route('**/*', (route) => {
        const url = route.request().url();
        // Block analytics, ads, and some media that we don't need
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

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    if (SHOULD_LOGIN) {
        await login(page);
    } else {
        console.log("Skipping login as per configuration. Some content (polls, etc.) may be missing.");
    }

    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    const allData = [];
    for (const url of urls) {
        let retryCount = 0;
        const maxRetries = 3;
        let success = false;

        while (retryCount <= maxRetries && !success) {
            try {
                const startTime = Date.now();
                const data = await extractPostData(page, url);
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

                const identifier = url.split('/').pop() || `post_${Date.now()}`;
                const filePath = `${OUT_DIR}/${identifier}.json`;

                await downloadAllImages(data, url);

                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                console.log(`✅ Saved: ${filePath} (${elapsed}s, ${data.replies.length} top-level comments)`);

                allData.push(data);
                success = true;
            } catch (e) {
                if (e.message === "RATE_LIMITED" || e.message.includes("Timeout")) {
                    retryCount++;
                    const waitTime = Math.pow(2, retryCount) * 10000; // Exponential backoff: 20s, 40s, 80s
                    console.log(`⚠️ ${e.message === "RATE_LIMITED" ? "Rate limited" : "Timeout"}. Retry ${retryCount}/${maxRetries} in ${waitTime / 1000}s...`);

                    if (e.message === "RATE_LIMITED") {
                        // If rate limited, try to "unstick" by going to home page
                        await page.goto("https://www.teamblind.com/", { waitUntil: "domcontentloaded" }).catch(() => { });
                    }

                    await page.waitForTimeout(waitTime);
                } else {
                    console.error(`❌ Error scraping ${url}:`, e.message);
                    break; // Non-retryable error
                }
            }
        }

        if (!success) {
            console.error(`❌ Permanent failure for ${url} after ${maxRetries} retries.`);
        }

        // Adaptive delay between posts (3-7 seconds randomized)
        const delay = 3000 + Math.random() * 4000;
        await page.waitForTimeout(delay);
    }

    if (browser) {
        await browser.close();
    } else {
        await context.close();
    }
    console.log("✅ Scraping completed.");
}

export { extractPostData, startScraping };

const isMain = process.argv[1].endsWith('extract_post_details_optimized.mjs');
if (isMain) {
    startScraping().catch(console.error);
}
