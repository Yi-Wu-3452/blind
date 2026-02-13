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
const MAX_CONCURRENT_WORKERS = 2; // Reduced for stability

// Timing constants
const WAIT_AFTER_CLICK = 1000;
const WAIT_AFTER_NAVIGATION = 1200;
const LOAD_MORE_TIMEOUT = 5000;

// Shared State
const sharedState = {
    isRateLimited: false,
    backoffEndTime: 0,
    processedPosts: new Set(),
    totalSaved: 0,
    pagesToScrape: []
};

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
        const signInBtn = await page.$('button:has-text("Sign in"), a:has-text("Sign in"), button.bg-\\[\\#D83C3D\\]');
        if (signInBtn) {
            console.log("Clicking Sign in button...");
            await signInBtn.click();
        } else {
            console.log("Sign in trigger not found. Navigating to /sign-in...");
            await page.goto("https://www.teamblind.com/sign-in", { waitUntil: "networkidle" });
        }
    }

    // Add stability delay
    await page.waitForTimeout(3000);

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 30000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.waitForTimeout(500);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.waitForTimeout(500);
        await page.click('button[type="submit"]');

        console.log("Login form submitted. Waiting for redirection...");

        await page.waitForFunction(() => {
            const url = window.location.href;
            const hasEmailField = !!document.querySelector('input[name="email"]');
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required') && !hasEmailField;
        }, { timeout: 45000 });

        console.log("Auto-login successful.");
    } catch (e) {
        if (!page.isClosed()) {
            console.error("Login failed:", e.message);
            const debugPath = path.resolve(__dirname, "../../login_error_parallel.png");
            await page.screenshot({ path: debugPath });
        }
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
        const status = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            if (bodyText.includes("Oops! Something went wrong") && bodyText.includes("blindapp@teamblind.com")) {
                console.log("[DEBUG] Rate limit text detected: Oops! Something went wrong");
                return "rate_limited";
            }

            let dismissed = false;
            // 1. Common close buttons
            const closeSelectors = [
                'button.absolute.right-4.top-4',
                'button[aria-label="Close"]',
                '.icon-close',
                'div[class*="CloseButton"]'
            ];
            closeSelectors.forEach(s => {
                const btn = document.querySelector(s);
                if (btn && btn.offsetParent !== null) {
                    btn.click();
                    dismissed = true;
                }
            });

            // 2. Aggressive modal removal (Join/Sign up / Full Access / Read-only)
            const blockerTexts = [
                'Join the conversation',
                'Sign up to read more',
                'Sign up for free',
                'Download the app',
                'Get Full Access',
                'read-only mode'
            ];
            const divs = Array.from(document.querySelectorAll('div, section, aside, header'));
            divs.forEach(div => {
                const style = window.getComputedStyle(div);
                if (style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky') {
                    if (blockerTexts.some(text => div.textContent.includes(text))) {
                        div.remove();
                        dismissed = "agg_removed";
                    }
                }
            });

            // 3. Prevent scroll lock and blur
            if (document.body.style.overflow === 'hidden') document.body.style.overflow = 'auto';
            document.body.style.filter = 'none';
            const main = document.querySelector('main, #root');
            if (main) main.style.filter = 'none';

            return dismissed;
        });
        return status;
    } catch (e) { }
    return false;
}

async function extractPostData(page, url) {
    const scrapeTimeRaw = new Date();
    const scrapeTime = getFormattedScrapeTime();

    const status = await dismissBlockers(page);
    if (status === "rate_limited") throw new Error("RATE_LIMITED");

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

    const attemptedIds = new Set();
    const threadResults = {};

    // Load more comments
    let loadMoreVisible = true;
    let loadMoreAttempts = 0;
    while (loadMoreVisible && loadMoreAttempts < 50) {
        try {
            const loadMoreBtn = await page.$('button:has-text("View more comments")');
            if (loadMoreBtn) {
                await loadMoreBtn.click({ force: true });
                await dismissBlockers(page);
                await waitForDOMStability(page, WAIT_AFTER_CLICK);
                loadMoreAttempts++;
            } else { loadMoreVisible = false; }
        } catch (e) { loadMoreVisible = false; }
    }

    // Expansion loop
    let loopCount = 0;
    let progressMade = true;
    while (progressMade && loopCount < 100) {
        loopCount++; progressMade = false;
        const buttons = await page.$$('button:has-text("more reply"), button:has-text("more replies"), a:has-text("more reply"), a:has-text("more replies"), button:has-text("Show more"), a:has-text("Show more")');
        for (const btn of buttons) {
            let btnInfo;
            try {
                btnInfo = await btn.evaluate(node => {
                    const isRealComment = (el) => el?.id?.startsWith('comment-') && !el?.id?.startsWith('comment-group-');
                    let comment = node.closest('div[id^="comment-"]');
                    if (comment && comment.id.startsWith('comment-group-')) comment = null;

                    if (!comment) {
                        const container = node.closest('div[class*="pl-"]');
                        if (container) {
                            let prev = container.previousElementSibling;
                            while (prev && !isRealComment(prev)) {
                                prev = prev.previousElementSibling;
                            }
                            if (prev) comment = prev;
                            else {
                                let parentPrev = container.parentElement?.previousElementSibling;
                                if (parentPrev && isRealComment(parentPrev)) comment = parentPrev;
                            }
                        }
                    }
                    return {
                        id: comment ? comment.id : 'global',
                        text: node.innerText.trim(),
                        content: comment ? comment.innerText.slice(0, 50).replace(/\n/g, ' ') + "..." : "N/A",
                        isLink: node.tagName === 'A' || !!node.getAttribute('href') || !!node.closest('a')
                    };
                });
            } catch (e) { continue; }

            const key = `${btnInfo.id}-${btnInfo.text}`;
            if (attemptedIds.has(key) || (btnInfo.id === 'global' && btnInfo.isLink)) continue;

            const currentUrl = page.url();
            try {
                // Use JS click to bypass potential overlaps with "Add a comment" field
                await btn.evaluate(b => b.click());
                await dismissBlockers(page);
                attemptedIds.add(key);
                await page.waitForTimeout(WAIT_AFTER_CLICK);
            } catch (e) { continue; }

            if (page.url() !== currentUrl) {
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
                        threadResults[threadData.id] = threadData.replies;
                    }
                } catch (e) { }
                await page.goBack({ waitUntil: "domcontentloaded" });
                await page.waitForTimeout(WAIT_AFTER_NAVIGATION);
            }
            progressMade = true; break;
        }
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(200);
    }

    // Final extraction
    const data = await page.evaluate(({ externalThreadResults, scrapeTimeRaw, formattedScrapeTime }) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
        const title = getSafeText("h1");
        const content = getSafeText("p.whitespace-pre-wrap.break-words");
        const postImages = Array.from(document.querySelectorAll('img[src*="/uploads/atch_img/"]')).filter(img => !img.closest('div[id^="comment-"]')).map(img => img.src);
        const channel = getSafeText('a[data-testid="article-preview-channel"]');
        const rawDate = document.querySelector('a[data-testid="article-preview-channel"]')?.parentElement?.querySelector('span')?.textContent?.trim() || "";

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

        const extractReplies = (rootElement) => {
            const commentId = rootElement.id;
            if (commentId && externalThreadResults[commentId]) return externalThreadResults[commentId];
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
                    nested: extractReplies(el)
                };
            });
        };

        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => !el.parentElement.closest('div[class*="pl-"]'));
        const replies = rootCommentElements.map(el => {
            const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
            const nestedReplies = extractReplies(el);

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

    return { url, ...data };
}

async function runWorker(workerId, context, companyName) {
    console.log(`[Worker ${workerId}] Started.`);
    const page = await context.newPage();

    while (sharedState.pagesToScrape.length > 0) {
        // Handle global backoff
        if (sharedState.isRateLimited) {
            const waitTime = Math.max(0, sharedState.backoffEndTime - Date.now());
            if (waitTime > 0) {
                console.log(`[Worker ${workerId}] Global backoff in progress. Waiting ${Math.ceil(waitTime / 1000)}s...`);
                await new Promise(r => setTimeout(r, 5000));
                continue;
            } else {
                sharedState.isRateLimited = false;
            }
        }

        const p = sharedState.pagesToScrape.shift();
        if (p === undefined) break;

        const listUrl = `https://www.teamblind.com/company/${companyName}/posts?page=${p}`;
        console.log(`[Worker ${workerId}] Scrutinizing Page ${p}...`);

        try {
            await page.goto(listUrl, { waitUntil: "networkidle", timeout: 45000 });
            const status = await dismissBlockers(page);
            if (status === "rate_limited") {
                console.log(`[Worker ${workerId}] ⚠️ Possible rate limit on list page ${p}. Pausing 30s and retrying...`);
                await page.waitForTimeout(30000);
                await page.reload({ waitUntil: "networkidle" });
                const statusRetry = await dismissBlockers(page);
                if (statusRetry === "rate_limited") {
                    console.log(`[Worker ${workerId}] 🛑 Confirmed rate limit on list page ${p}. Triggering global backoff.`);
                    sharedState.isRateLimited = true;
                    sharedState.backoffEndTime = Date.now() + 300000; // 5 min
                    sharedState.pagesToScrape.unshift(p); // Re-queue
                    continue;
                }
            }

            const postLinks = await page.$$eval('article a.block.h-full', els => els.map(el => el.href));
            const pageDir = path.join(BASE_OUT_DIR, companyName, `page_${p}`);
            if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

            for (const postUrl of postLinks) {
                const slug = postUrl.split('/').pop();
                const filePath = path.join(pageDir, `${slug}.json`);

                if (fs.existsSync(filePath)) continue;

                let success = false;
                let retry = 0;
                while (retry < 2 && !success) {
                    const postPage = await context.newPage();
                    try {
                        await postPage.goto(postUrl, { waitUntil: "networkidle", timeout: 60000, referer: listUrl });
                        const data = await extractPostData(postPage, postUrl);
                        await downloadAllImages(data, postUrl);
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                        sharedState.totalSaved++;
                        console.log(`[Worker ${workerId}] ✅ Saved: ${slug} (Total: ${sharedState.totalSaved})`);
                        success = true;
                    } catch (e) {
                        retry++;
                        if (e.message === "RATE_LIMITED") {
                            console.log(`[Worker ${workerId}] ⚠️ Rate limited on post ${slug}. Global backoff.`);
                            sharedState.isRateLimited = true;
                            sharedState.backoffEndTime = Date.now() + 300000;
                            break;
                        } else {
                            console.error(`[Worker ${workerId}] ❌ Error on ${slug}: ${e.message}`);
                        }
                    } finally {
                        await postPage.close();
                    }
                    if (sharedState.isRateLimited) break;
                }
                if (sharedState.isRateLimited) break;
                // Human reading pause: 10s to 20s
                const pause = 10000 + Math.random() * 10000;
                console.log(`[Worker ${workerId}] Pausing for ${Math.round(pause / 1000)}s (simulated reading)...`);
                await new Promise(r => setTimeout(r, pause));
            }
        } catch (e) {
            console.error(`[Worker ${workerId}] ❌ Major error on Page ${p}: ${e.message}`);
            sharedState.pagesToScrape.push(p); // Optional: re-queue with limit
        }
    }

    await page.close();
    console.log(`[Worker ${workerId}] Finished.`);
}

async function startParallelScraping() {
    const COMPANY_NAME = process.argv[2] || "T-Mobile";
    const START_PAGE = parseInt(process.argv[3] || "1", 10);
    const MAX_PAGES = process.argv[4] ? parseInt(process.argv[4], 10) : 100;
    const WORKER_COUNT = process.argv[5] ? parseInt(process.argv[5], 10) : MAX_CONCURRENT_WORKERS;

    console.log(`🚀 Starting PARALLEL organic scraper for: ${COMPANY_NAME}`);
    console.log(`🚀 Workers: ${WORKER_COUNT} | Range: Page ${START_PAGE} to ${START_PAGE + MAX_PAGES - 1}`);

    // Populate queue
    for (let i = START_PAGE; i < START_PAGE + MAX_PAGES; i++) {
        sharedState.pagesToScrape.push(i);
    }

    // Use persistent context to save cookies/session
    const userDataDir = path.resolve(__dirname, "../../browser_profile");
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`Using persistent browser profile at: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome', // Force using installed Google Chrome
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
            '--window-size=1920,1080',
            '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"'
        ],
        viewport: { width: 1920, height: 1080 }
    });

    // Login once (if needed)
    if (SHOULD_LOGIN) {
        const pages = context.pages();
        const loginPage = pages.length > 0 ? pages[0] : await context.newPage();
        await login(loginPage);
        // Leave the page open or close it? Better to keep one page open in persistent context
    }

    // Launch workers
    const workers = [];
    for (let i = 1; i <= WORKER_COUNT; i++) {
        workers.push(runWorker(i, context, COMPANY_NAME));
        // Stagger starts
        await new Promise(r => setTimeout(r, 5000));
    }

    await Promise.all(workers);
    await browser.close();
    console.log("\n✅ Parallel organic scraping session completed.");
}

startParallelScraping().catch(console.error);
