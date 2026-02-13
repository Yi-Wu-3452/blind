import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_OUT_DIR = path.resolve(__dirname, "../../data/organic_scrapes");
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

const SHOULD_LOGIN = true;

// Timing constants
const WAIT_AFTER_CLICK = 1000;
const WAIT_AFTER_NAVIGATION = 1200;
const LOAD_MORE_TIMEOUT = 5000;

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
    await page.goto("https://www.teamblind.com/", { waitUntil: "networkidle" });

    // Check if already logged in
    const isLoggedIn = await page.evaluate(() => {
        return !!document.querySelector('a[href="/my-page"]') ||
            Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Log out'));
    }).catch(() => false);

    if (isLoggedIn) {
        console.log("Already logged in.");
        return;
    }

    // Look for the "Sign in" button in the header if form not visible
    const emailVisible = await page.$('input[name="email"]').then(el => el ? el.isVisible() : false).catch(() => false);

    if (!emailVisible) {
        console.log("Login form not visible. Looking for Sign in trigger...");
        // Red button with specific background color or text
        const signInBtn = await page.$('button:has-text("Sign in"), a:has-text("Sign in"), button.bg-\\[\\#D83C3D\\]');
        if (signInBtn) {
            console.log("Clicking Sign in button...");
            await signInBtn.click();
        } else {
            console.log("Sign in trigger not found. Navigating to /sign-in...");
            await page.goto("https://www.teamblind.com/sign-in", { waitUntil: "networkidle" });
        }
    }

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);

        // Click the submit button inside the modal/form
        await page.click('button[type="submit"]');

        console.log("Login form submitted. Waiting for redirection...");

        await page.waitForFunction(() => {
            const url = window.location.href;
            const hasEmailField = !!document.querySelector('input[name="email"]');
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required') && !hasEmailField;
        }, { timeout: 30000 });

        console.log("Auto-login successful.");
    } catch (e) {
        console.error("Login failed:", e.message);
        const debugPath = path.resolve(__dirname, "../../login_error.png");
        await page.screenshot({ path: debugPath });
        console.log(`Saved login error screenshot to: ${debugPath}`);
        throw e;
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

    if (data.replies) await processReplies(data.replies);
}

async function waitForDOMStability(page, minStableTime = 300, maxWait = 3000) {
    const startTime = Date.now();
    let lastCommentCount = await page.$$eval('div[id^="comment-"]', els => els.length);
    let stableStartTime = null;

    while (Date.now() - startTime < maxWait) {
        await page.waitForTimeout(150);
        const currentCount = await page.$$eval('div[id^="comment-"]', els => els.length);

        if (currentCount === lastCommentCount) {
            if (stableStartTime === null) {
                stableStartTime = Date.now();
            } else if (Date.now() - stableStartTime >= minStableTime) {
                return true;
            }
        } else {
            stableStartTime = null;
            lastCommentCount = currentCount;
        }
    }
    return stableStartTime !== null;
}

async function dismissBlockers(page) {
    try {
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
    } catch (e) { }
    return false;
}

async function extractPostData(page, url) {
    const scrapeTimeRaw = new Date();
    const scrapeTime = getFormattedScrapeTime();

    const status = await dismissBlockers(page);
    if (status === "rate_limited") {
        throw new Error("RATE_LIMITED");
    }

    try {
        await page.waitForSelector('h1', { timeout: 15000 });
    } catch (e) {
        throw new Error("POST_CONTENT_MISSING");
    }

    await page.evaluate(() => {
        const selectors = ['section.sticky', 'div.sticky', '[class*="sticky"]', '[class*="Overlay"]', '[class*="Modal"]', '#onetrust-banner-sdk'];
        selectors.forEach(s => {
            const elements = document.querySelectorAll(s);
            elements.forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky') el.style.display = 'none';
            });
        });
    });

    await dismissBlockers(page);

    const attemptedIds = new Set();
    const threadResults = {};
    const debug_info = { batch_clicks: 0, nested_clicks: 0, focused_thread_scrapes: 0, expansion_logs: [] };

    // Load more comments
    let loadMoreVisible = true;
    let loadMoreAttempts = 0;
    while (loadMoreVisible && loadMoreAttempts < 50) {
        try {
            await page.waitForSelector('button:has-text("View more comments")', { timeout: LOAD_MORE_TIMEOUT });
            const loadMoreBtn = await page.$('button:has-text("View more comments")');
            if (loadMoreBtn) {
                const beforeCount = await page.$$eval('div[id^="comment-"]', els => els.length);
                debug_info.batch_clicks++;
                await loadMoreBtn.click({ force: true, timeout: 5000 });
                await dismissBlockers(page);
                await waitForDOMStability(page, WAIT_AFTER_CLICK);
                const afterCount = await page.$$eval('div[id^="comment-"]', els => els.length);
                loadMoreAttempts++;
                console.log(`  ✓ Loaded ${afterCount - beforeCount} more comments (total: ${afterCount})`);
            } else { loadMoreVisible = false; }
        } catch (e) { loadMoreVisible = false; }
    }

    // Expansion loop
    let loopCount = 0;
    let progressMade = true;
    while (progressMade && loopCount < 150) {
        loopCount++; progressMade = false;
        const buttons = await page.$$('button:has-text("more reply"), button:has-text("more replies"), a:has-text("more reply"), a:has-text("more replies"), button:has-text("Show more"), a:has-text("Show more")');
        for (const btn of buttons) {
            let btnInfo;
            try {
                btnInfo = await btn.evaluate(node => {
                    const comment = node.closest('div[id^="comment-"]');
                    return { id: comment ? comment.id : null, text: node.innerText.trim(), isLink: node.tagName === 'A' || !!node.getAttribute('href') || !!node.closest('a') };
                });
            } catch (e) { continue; }

            const key = btnInfo.id ? `${btnInfo.id}-${btnInfo.text}` : btnInfo.text;
            if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) continue;

            const currentUrl = page.url();
            console.log(`  ⚡ Expanding ${key}...`);

            try {
                await btn.click({ timeout: 5000, force: true });
                await dismissBlockers(page);
                attemptedIds.add(key);
                await page.waitForTimeout(WAIT_AFTER_CLICK);
            } catch (e) { continue; }

            if (page.url() !== currentUrl) {
                console.log(`    → Navigated to thread view`);
                try {
                    await page.waitForSelector('div[id^="comment-"]', { timeout: 8000 });
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
                            if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) threadContainer = rootElement.nextElementSibling;
                            if (!threadContainer) {
                                const parentSibling = rootElement.parentElement?.nextElementSibling;
                                if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
                            }
                            if (!threadContainer) return [];

                            const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                                let parent = el.parentElement;
                                while (parent && parent !== threadContainer) {
                                    if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) return false;
                                    parent = parent.parentElement;
                                }
                                return true;
                            });

                            return replyElements.map(el => {
                                const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                                return {
                                    userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "",
                                    company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                                    date: normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || ""),
                                    content: el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                                    likes: el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                                    images: Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src),
                                    commentId: el.id,
                                    nested: extractRepliesRecursive(el)
                                };
                            });
                        };

                        const rootComment = document.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                        return { id: rootComment ? rootComment.id : null, replies: rootComment ? extractRepliesRecursive(rootComment) : [] };
                    }, { scrapeTimeRaw: scrapeTimeRaw.getTime() });

                    if (threadData.id) {
                        console.log(`    ✓ Scraped ${threadData.replies.length} replies for ${threadData.id}`);
                        debug_info.focused_thread_scrapes++;
                        threadResults[threadData.id] = threadData.replies;
                    }
                } catch (e) { }
                await page.goBack({ waitUntil: "domcontentloaded" });
                await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
            }
            progressMade = true; break;
        }
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(300);
    }

    // Reveal poll result
    try {
        const viewResultBtn = await page.$('button:has-text("View Result")');
        if (viewResultBtn) { await viewResultBtn.click(); await page.waitForTimeout(800); }
    } catch (e) { }

    // Final extraction
    const data = await page.evaluate(({ externalThreadResults, scrapeTimeRaw, formattedScrapeTime }) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
        const title = getSafeText("h1");
        const content = getSafeText("p.whitespace-pre-wrap.break-words");
        const postImages = Array.from(document.querySelectorAll('img[src*="/uploads/atch_img/"]')).filter(img => !img.closest('div[id^="comment-"]')).map(img => img.src);
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
                userCompany = opHeader.querySelector('a[href^="/company/"]')?.textContent?.trim() || "";
                const textNodes = nodes.filter(node => node.nodeType === 3).map(node => node.textContent.trim()).filter(txt => txt.length > 1 && !txt.includes('·'));
                if (textNodes.length > 0) userName = textNodes[textNodes.length - 1];
            }
        }

        const likes = (document.querySelector('button[aria-label="Like this post"]') || document.querySelector('.icon-like')?.parentElement)?.textContent?.trim() || "0";
        const views = document.querySelector('button[aria-label="Views"]')?.getAttribute('data-count') || "0";
        const commentsCount = (document.querySelector('button[aria-label="Comment on this post"]') || document.querySelector('.icon-comment')?.parentElement)?.textContent?.trim() || "0";

        // Poll/Offer
        let post_type = "regular_post";
        let pollContainer = Array.from(document.querySelectorAll('span, div')).find(el => (el.textContent === "Poll" || el.textContent === "Offer"))?.closest('div.rounded-lg.border');
        let pollData = null;
        if (pollContainer) {
            post_type = pollContainer.textContent.includes("Offer") ? "offer" : "poll";
            const options = [];
            const participantsText = pollContainer.textContent?.match(/([\d,]+)\s*Participants?/i);
            const participants = participantsText ? parseInt(participantsText[1].replace(/,/g, ''), 10) : 0;
            if (post_type === "poll") {
                const rows = Array.from(pollContainer.querySelectorAll('div.relative.mb-3, div.relative')).filter(r => r.textContent?.includes('%'));
                rows.forEach(row => {
                    const label = row.querySelector('.flex-1.text-sm')?.textContent?.trim() || row.querySelector('label')?.textContent?.trim() || "";
                    const res = row.querySelector('.text-xs.font-semibold')?.textContent?.trim() || "";
                    const match = res.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);
                    if (label && match) options.push({ label, percent: parseFloat(match[1]), votes: parseInt(match[2], 10) });
                });
            } else {
                const blocks = pollContainer.querySelectorAll('div.flex.space-x-2.rounded-lg.border');
                blocks.forEach(block => {
                    const label = block.querySelector('label')?.textContent?.trim() || "";
                    const res = block.querySelector('.text-xs.font-semibold')?.textContent?.trim() || "";
                    const match = res.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);
                    if (label && match) options.push({ label, percent: match ? parseFloat(match[1]) : 0, votes: match ? parseInt(match[2], 10) : 0 });
                });
            }
            pollData = { post_type, participants, options };
        }

        const extractReplies = (rootElement) => {
            const commentId = rootElement.id;
            if (commentId && externalThreadResults[commentId]) return externalThreadResults[commentId];
            let threadContainer = rootElement.querySelector('div[class*="pl-"]');
            if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) threadContainer = rootElement.nextElementSibling;
            if (!threadContainer) return [];
            const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                let parent = el.parentElement;
                while (parent && parent !== threadContainer) {
                    if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) return false;
                    parent = parent.parentElement;
                }
                return true;
            });
            return replyElements.map(el => {
                const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                return {
                    userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "",
                    company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                    date: normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || ""),
                    content: el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                    likes: el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                    images: Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src),
                    commentId: el.id,
                    nested: extractReplies(el)
                };
            });
        };

        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => !el.parentElement.closest('div[class*="pl-"]'));
        const replies = rootCommentElements.map(el => {
            const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
            const nestedReplies = extractReplies(el);
            const moreBtn = Array.from(el.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));
            const buttonCount = moreBtn ? (parseInt(moreBtn.innerText.match(/(\d+)/)?.[1] || "0", 10)) : 0;
            return {
                userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "",
                company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                date: normalizeDateInternal(header?.querySelector('span.text-gray-600')?.textContent?.trim() || ""),
                content: el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                likes: el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                images: Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src),
                commentId: el.id,
                nested: nestedReplies,
                expectedNestedCount: nestedReplies.length + buttonCount
            };
        });

        return {
            scrapeTime: formattedScrapeTime,
            post_type: pollData?.post_type || "regular_post",
            title, content, userName, userCompany, date, channel, likes, views, commentsCount,
            images: postImages, poll: pollData, replies
        };
    }, { externalThreadResults: threadResults, scrapeTimeRaw: scrapeTimeRaw.getTime(), formattedScrapeTime: scrapeTime });

    data.debug = { ...data.debug, ...debug_info };
    return { url, ...data };
}

async function startOrganicScraping() {
    const COMPANY_NAME = process.argv[2] || "T-Mobile";
    const START_PAGE = parseInt(process.argv[3] || "1", 10);
    const MAX_PAGES = process.argv[4] ? parseInt(process.argv[4], 10) : 100;

    console.log(`⚡ Starting ORGANIC company scraper for: ${COMPANY_NAME}`);
    console.log(`⚡ Range: Page ${START_PAGE} to ${START_PAGE + MAX_PAGES - 1}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (SHOULD_LOGIN) {
        await login(page);
    }

    for (let p = START_PAGE; p < START_PAGE + MAX_PAGES; p++) {
        const listUrl = `https://www.teamblind.com/company/${COMPANY_NAME}/posts?page=${p}`;
        console.log(`\n📄 --- Scrutinizing Page ${p} ---`);

        try {
            await page.goto(listUrl, { waitUntil: "networkidle", timeout: 45000 });
            const status = await dismissBlockers(page);
            if (status === "rate_limited") {
                console.log("🛑 Rate limited on list page. Cooling down...");
                await page.waitForTimeout(300000); // 5 min
                p--; continue;
            }

            const postLinks = await page.$$eval('article a.block.h-full', els => els.map(el => el.href));
            console.log(`🔍 Found ${postLinks.length} posts on page ${p}`);

            const pageDir = path.join(BASE_OUT_DIR, COMPANY_NAME, `page_${p}`);
            if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

            for (const postUrl of postLinks) {
                const slug = postUrl.split('/').pop();
                const filePath = path.join(pageDir, `${slug}.json`);

                if (fs.existsSync(filePath)) {
                    console.log(`⏭️ Skipping (already exists): ${slug}`);
                    continue;
                }

                console.log(`👉 Clicking into: ${slug}`);
                let retry = 0;
                let success = false;
                while (retry < 3 && !success) {
                    try {
                        const link = await page.$(`article a[href*="${slug}"]`);
                        if (link) {
                            await link.click({ force: true });
                            await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
                            const data = await extractPostData(page, postUrl);
                            await downloadAllImages(data, postUrl);
                            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                            console.log(`✅ Saved: ${filePath} (${data.replies.length} comments)`);
                            success = true;
                        } else {
                            throw new Error("LINK_NOT_FOUND");
                        }
                    } catch (e) {
                        retry++;
                        if (e.message === "RATE_LIMITED") {
                            console.log(`⚠️ Rate limit hit. Cooling down 5m...`);
                            await page.waitForTimeout(300000);
                            await page.goto(listUrl, { waitUntil: "networkidle" });
                        } else {
                            console.log(`❌ Error: ${e.message}. Retrying...`);
                            await page.goto(listUrl, { waitUntil: "networkidle" });
                        }
                    }
                }
                if (!success) console.error(`❌ Failed to scrape: ${postUrl}`);
                await page.goto(listUrl, { waitUntil: "networkidle" }).catch(() => { });
                const delay = 5000 + Math.random() * 8000;
                await page.waitForTimeout(delay);
            }
        } catch (e) {
            console.error(`❌ Global error on page ${p}: ${e.message}`);
        }
    }
    await browser.close();
    console.log("\n✅ Organic scraping session completed.");
}

startOrganicScraping().catch(console.error);
