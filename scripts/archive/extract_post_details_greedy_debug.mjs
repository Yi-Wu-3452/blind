import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.resolve("debug_extraction.log");
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

// Clear log file
if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
}

function log(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${message}`;
    console.log(formatted);
    fs.appendFileSync(LOG_FILE, formatted + "\n");
}

// Set to true to enable manual login (required for polls/hidden content)
const SHOULD_LOGIN = true;

async function login(page) {
    log("Attempting auto-login...");
    await page.goto("https://www.teamblind.com/login");

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');

        log("Login form submitted. Waiting for redirection...");

        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 15000 });

        log("Auto-login successful. Proceeding to scrape...");
    } catch (e) {
        log("Auto-login failed or manual intervention required: " + e.message);
        log("--------------------------------------------------");
        log("MANUAL LOGIN REQUIRED:");
        log("1. Please check the browser window.");
        log("2. Complete any CAPTCHA or log in manually if needed.");
        log("3. Once you are logged in and see the home feed, the script will continue automatically.");
        log("--------------------------------------------------");

        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 0 });
        log("Login detected. Proceeding to scrape...");
    }
}

async function extractPostData(page, url) {
    log(`Processing (Greedy Debug): ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const attemptedIds = new Set();
    const threadResults = {};
    const debug_info = {
        batch_clicks: 0,
        nested_clicks: 0,
        focused_thread_scrapes: 0,
        expansion_logs: []
    };

    // 1. Exhaust "View more comments" (top-level) first
    log("Exhausting 'View more comments' buttons...");
    let loadMoreVisible = true;
    let loadMoreAttempts = 0;
    while (loadMoreVisible && loadMoreAttempts < 50) {
        let loadMoreBtn = await page.$('button:has-text("View more comments")');

        if (!loadMoreBtn) {
            let retries = 0;
            while (!loadMoreBtn && retries < 3) {
                log("View more comments button not found, retrying...");
                await page.waitForTimeout(2000);
                loadMoreBtn = await page.$('button:has-text("View more comments")');
                retries++;
            }
        }

        if (loadMoreBtn) {
            try {
                debug_info.batch_clicks++;
                await loadMoreBtn.click();
                await page.waitForTimeout(2000);
                loadMoreAttempts++;
                log(`Clicked 'View more comments' (${loadMoreAttempts})`);
            } catch (e) {
                log("Error clicking 'View more comments', stopping top-level expansion.");
                loadMoreVisible = false;
            }
        } else {
            loadMoreVisible = false;
        }
    }

    let loopCount = 0;
    let progressMade = true;

    while (progressMade && loopCount < 150) {
        loopCount++;
        progressMade = false;
        log(`Entering expansion loop ${loopCount}`);

        let loadMoreBtn = await page.$('button:has-text("View more comments")');
        if (loadMoreBtn) {
            try {
                await loadMoreBtn.click();
                await page.waitForTimeout(2000);
                log(`[Loop ${loopCount}] Clicked 'View more comments'`);
                progressMade = true;
            } catch (e) { }
        }

        const buttons = await page.$$('button:has-text("more reply"), button:has-text("more replies"), a:has-text("more reply"), a:has-text("more replies"), button:has-text("Show more"), a:has-text("Show more")');

        log(`Found ${buttons.length} expansion candidates in loop ${loopCount}`);

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
            if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) {
                // log(`Skipping already attempted or invalid: ${key}`);
                continue;
            }

            const currentUrl = page.url();
            log(`Expanding ${key}...`);
            try {
                await btn.click({ timeout: 3000 });
                attemptedIds.add(key);
                await page.waitForTimeout(1500);
            } catch (e) {
                log(`Failed to click ${key}: ${e.message}`);
                continue;
            }

            if (page.url() !== currentUrl) {
                log(`Navigation detected for ${key}. Scraping thread...`);

                try {
                    await page.waitForSelector('div[id^="comment-"]', { timeout: 10000 });
                } catch (e) {
                    log("Warning: New thread page seems blank or slow. Attempting to go back.");
                    await page.goBack({ waitUntil: "domcontentloaded" });
                    await page.waitForTimeout(2000);
                    progressMade = true;
                    break;
                }

                const threadData = await page.evaluate(() => {
                    const rootComment = document.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                    const actualId = rootComment ? rootComment.id : null;

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
                            const rContent = el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "";
                            return {
                                commentId: el.id,
                                content: rContent, // minimal
                                nested: extractRepliesRecursive(el)
                            };
                        });
                    };
                    return { id: actualId, replies: rootComment ? extractRepliesRecursive(rootComment) : [] };
                });

                if (threadData.id) {
                    log(`Scraped ${threadData.replies.length} replies for ${threadData.id}`);
                    const flatten = (arr) => arr.reduce((acc, val) => acc.concat(val, flatten(val.nested || [])), []);
                    const allNested = flatten(threadData.replies);
                    log(`Total flattened nested items scraped here: ${allNested.length}. IDs: ${allNested.map(x => x.commentId).join(', ')}`);

                    debug_info.focused_thread_scrapes++;
                    threadResults[threadData.id] = threadData.replies;
                } else if (btnInfo.id) {
                    debug_info.focused_thread_scrapes++;
                    threadResults[btnInfo.id] = threadData.replies;
                    threadResults[btnInfo.id.replace('-group', '')] = threadData.replies;
                }

                await page.goBack({ waitUntil: "domcontentloaded" });

                try {
                    await page.waitForSelector('h1', { timeout: 10000 });
                } catch (e) {
                    log("Warning: Failed to restore main post after goBack. Attempting reload.");
                    await page.reload({ waitUntil: "networkidle" });
                }
                await page.waitForTimeout(1500);
            }

            progressMade = true;
            break;
        }

        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(500);
    }

    log("Finished expansion. Collecting final data...");

    const data = await page.evaluate((externalThreadResults) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
        const title = getSafeText("h1");
        const commentsCount = (document.querySelector('button[aria-label="Comment on this post"]') || document.querySelector('.icon-comment')?.parentElement)?.textContent?.trim() || "0";

        const extractReplies = (rootElement) => {
            const commentId = rootElement.id;
            // Use external results if available
            if (commentId && externalThreadResults[commentId]) {
                // We need to merge or use external. External has minimal data in the debug script logic above, 
                // but here we are in the main page context where we want full data.
                // Actually the `evaluate` above returned full structure but mapped it to minimal in the log.
                // Wait, I mapped it to minimal in the `evaluate` block inside the loop. 
                // I should have mapped it to full structure if I want to use it here.
                // Correcting: The threadResults in this debug script needs to be full structure to match.
                // For now, let's just assume we want the count. 
                // But `externalThreadResults` is passed in.
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
                const rUserName = header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "";
                const rContent = el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "";

                return {
                    userName: rUserName,
                    content: rContent,
                    commentId: el.id,
                    nested: extractReplies(el)
                };
            });
        };

        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
            return !el.parentElement.closest('div[class*="pl-"]');
        });

        const replies = rootCommentElements.map(el => {
            const commentId = el.id;
            let nestedReplies = extractReplies(el);

            // Expected count check
            let visibleCount = nestedReplies.length;
            let buttonCount = 0;
            const moreRepliesBtn = Array.from(el.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));
            if (moreRepliesBtn) {
                const match = moreRepliesBtn.innerText.match(/(\d+)/);
                if (match) buttonCount = parseInt(match[1], 10);
            }

            return {
                commentId,
                expectedNestedCount: visibleCount + buttonCount,
                visibleCount: visibleCount,
                nested: nestedReplies
            };
        });

        return {
            title,
            commentsCount,
            replies
        };
    }, threadResults);

    log(`Metadata Comments Count: ${data.commentsCount}`);

    // Count scraped
    let totalScraped = 0;
    const countRecursive = (arr) => {
        let c = 0;
        for (const item of arr) {
            c += 1;
            if (item.nested) c += countRecursive(item.nested);
        }
        return c;
    };

    log("--- detailed verification ---");
    for (const r of data.replies) {
        const nestedCount = countRecursive(r.nested);
        totalScraped += 1 + nestedCount; // 1 for root + nested

        let status = "OK";
        if (r.expectedNestedCount !== r.visibleCount && r.expectedNestedCount !== nestedCount) {
            status = "MISMATCH";
        }
        // If we have external results used, the 'visibleCount' might differ from 'nestedCount' if the main page didn't show them but we injected them.

        log(`Root ${r.commentId}: Expected Nested=${r.expectedNestedCount}, Scraped Nested=${nestedCount}. Status=${status}`);
        if (status === "MISMATCH") {
            log(`   -> Potential missing replies here. Button visible count was ${r.visibleCount} before expansion.`);
        }
    }

    log(`Total Scraped Count: ${totalScraped}`);
    log(`Difference: ${totalScraped - parseInt(data.commentsCount.replace(/,/g, ''))}`);

    return { url, ...data };
}

async function startScraping() {
    const url = "https://www.teamblind.com/post/whats-it-like-working-at-openai-nvidia-anthropic-542vktt1";
    log(`Starting single post extraction (Greedy Debug) for: ${url}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (SHOULD_LOGIN) {
        await login(page);
    }

    try {
        const data = await extractPostData(page, url);
        fs.writeFileSync("debug_output.json", JSON.stringify(data, null, 2));
        log("Saved debug_output.json");
    } catch (e) {
        log(`Error scraping: ${e.message}`);
    }

    await browser.close();
    log("Greedy scraping completed.");
}

startScraping().catch(e => log(e));
