import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.resolve(__dirname, "../../data/nvidia_post_urls.txt");
const OUT_DIR = path.resolve(__dirname, "../../data/posts_greedy");
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

// Set to true to enable manual login (required for polls/hidden content)
const SHOULD_LOGIN = true;

/**
 * Normalizes Blind's relative or absolute dates to YYYY-MM-DD
 * @param {string} dateStr - The date string from Blind (e.g., "4d", "Jan 19", "Oct 30, 2025")
 * @param {Date} referenceTime - The time the scrape occurred
 * @returns {string} - Output in YYYY-MM-DD format
 */
function normalizeDate(dateStr, referenceTime) {
    if (!dateStr) return "";
    const cleanStr = dateStr.trim().replace(/·/g, '').trim();
    if (!cleanStr) return "";

    const now = new Date(referenceTime);

    // Handle relative dates: "4d", "2h", "11m", "1s"
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

    // Handle absolute dates
    // Case: "Oct 30, 2025"
    if (cleanStr.includes(',')) {
        const date = new Date(cleanStr);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }

    // Case: "Jan 19" (assumes current year or previous if month is future)
    const monthDayMatch = cleanStr.match(/^([A-Za-z]+)\s+(\d+)$/);
    if (monthDayMatch) {
        const monthStr = monthDayMatch[1];
        const day = parseInt(monthDayMatch[2], 10);
        const year = now.getFullYear();
        const date = new Date(`${monthStr} ${day}, ${year}`);

        // If the parsed date is in the future relative to now, it's likely from last year
        if (date > now) {
            date.setFullYear(year - 1);
        }

        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }

    // Fallback: try native Date parsing
    const fallbackDate = new Date(cleanStr);
    if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate.toISOString().split('T')[0];
    }

    return cleanStr; // Return original if all else fails
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
    await page.goto("https://www.teamblind.com/login");

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');

        console.log("Login form submitted. Waiting for redirection...");

        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 15000 });

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

    // Process main post images
    data.localImages = [];
    if (data.images) {
        for (const url of data.images) {
            await downloadTask(url, "post", data.localImages);
        }
    }

    // Process replies recursively
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

async function extractPostData(page, url) {
    const scrapeTimeRaw = new Date();
    const scrapeTime = getFormattedScrapeTime();
    console.log(`Processing (Greedy): ${url} at ${scrapeTime}`);
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
    console.log("Exhausting 'View more comments' buttons...");
    let loadMoreVisible = true;
    let loadMoreAttempts = 0;
    const LOAD_MORE_TIMEOUT = 10000; // 10 second timeout
    while (loadMoreVisible && loadMoreAttempts < 50) {
        try {
            // Use timeout-based waiting instead of retry loops
            await page.waitForSelector('button:has-text("View more comments")', { timeout: LOAD_MORE_TIMEOUT });
            const loadMoreBtn = await page.$('button:has-text("View more comments")');

            if (loadMoreBtn) {
                debug_info.batch_clicks++;
                await loadMoreBtn.click();
                await page.waitForTimeout(2000);
                loadMoreAttempts++;
                console.log(`Clicked 'View more comments' (${loadMoreAttempts})`);
            } else {
                loadMoreVisible = false;
            }
        } catch (e) {
            // Timeout reached - no more buttons to click
            console.log(`No 'View more comments' button found within ${LOAD_MORE_TIMEOUT / 1000}s timeout. Stopping.`);
            loadMoreVisible = false;
        }
    }

    let loopCount = 0;
    let progressMade = true;

    // Use a unified loop for thread expansion
    while (progressMade && loopCount < 150) {
        loopCount++;
        progressMade = false;

        // 1. Re-Exhaust "View more comments" (top-level) on every pass
        // This is crucial because page.goBack() might reset the DOM state.
        let loadMoreVisible = true;
        let loadMoreAttempts = 0;
        const LOOP_LOAD_MORE_TIMEOUT = 5000; // 5 second timeout inside loop (faster)
        while (loadMoreVisible && loadMoreAttempts < 50) {
            try {
                await page.waitForSelector('button:has-text("View more comments")', { timeout: LOOP_LOAD_MORE_TIMEOUT });
                const loadMoreBtn = await page.$('button:has-text("View more comments")');

                if (loadMoreBtn) {
                    debug_info.batch_clicks++;
                    await loadMoreBtn.click();
                    await page.waitForTimeout(2000);
                    loadMoreAttempts++;
                    console.log(`[Loop ${loopCount}] Clicked 'View more comments' (${loadMoreAttempts})`);
                    progressMade = true;
                } else {
                    loadMoreVisible = false;
                }
            } catch (e) {
                // Timeout - no more buttons
                loadMoreVisible = false;
            }
        }

        // 2. Find expansion triggers (greedy)
        // Note: Top-level "View more comments" is now handled before this loop.
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
                continue; // Element likely detached
            }

            const key = btnInfo.id ? `${btnInfo.id}-${btnInfo.text}` : btnInfo.text;
            if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) continue;

            const currentUrl = page.url();
            console.log(`Expanding ${key}...`);
            try {
                await btn.click({ timeout: 3000 });
                attemptedIds.add(key);
                await page.waitForTimeout(1500);
            } catch (e) {
                console.log(`Failed to click ${key}: ${e.message}`);
                // If failed, we might want to try another button in this pass, OR break if the DOM is borked.
                // But generally if click fails, it might be stale.
                continue;
            }

            if (page.url() !== currentUrl) {
                console.log(`Navigation detected for ${key}. Scraping thread...`);

                // Verify the new page loaded content
                try {
                    await page.waitForSelector('div[id^="comment-"]', { timeout: 10000 });
                } catch (e) {
                    console.log("Warning: New thread page seems blank or slow. Attempting to go back.");
                    await page.goBack({ waitUntil: "domcontentloaded" });
                    await page.waitForTimeout(2000);
                    // It was a navigation failure, so we processed it (failed), break to query buttons again
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
                    console.log(`Scraped ${threadData.replies.length} replies for ${threadData.id}`);
                    debug_info.focused_thread_scrapes++;
                    threadResults[threadData.id] = threadData.replies;
                } else if (btnInfo.id) {
                    debug_info.focused_thread_scrapes++;
                    threadResults[btnInfo.id] = threadData.replies;
                    threadResults[btnInfo.id.replace('-group', '')] = threadData.replies;
                }

                await page.goBack({ waitUntil: "domcontentloaded" });

                // Verify we are back on the main post
                try {
                    await page.waitForSelector('h1', { timeout: 10000 });
                } catch (e) {
                    console.log("Warning: Failed to restore main post after goBack. Attempting reload.");
                    await page.reload({ waitUntil: "networkidle" });
                }
                await page.waitForTimeout(1500);
            }

            // If we successfully clicked and handled a button (nav or not), set progressMade and BREAK
            // to re-query the DOM for new buttons. This prevents stale element errors.
            progressMade = true;
            break;
        }

        // Trigger lazy loading
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(500);
    }

    // Click "View Result" on poll if present to reveal percentages
    try {
        const viewResultBtn = await page.$('button:has-text("View Result")');
        if (viewResultBtn) {
            console.log("Clicking 'View Result' to reveal poll percentages...");
            await viewResultBtn.click();
            await page.waitForTimeout(1500);
        }
    } catch (e) {
        // Poll might not exist or button not clickable, continue
    }

    const data = await page.evaluate(({ externalThreadResults, scrapeTimeRaw, formattedScrapeTime }) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";

        const title = getSafeText("h1");
        const content = getSafeText("p.whitespace-pre-wrap.break-words");
        const postImages = Array.from(document.querySelectorAll('article img[src*="/uploads/atch_img/"], main img[src*="/uploads/atch_img/"]')).map(img => img.src);
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

        // Find the post author header
        let userCompany = "";
        let userName = "Anonymous";

        // Primary Method: Target the specific OP info container
        const opHeader = document.querySelector('.flex.h-full.items-center.text-xs.text-gray-800');
        if (opHeader) {
            // New reliable logic based on child nodes
            const nodes = Array.from(opHeader.childNodes);
            if (nodes.length >= 3) {
                userCompany = nodes[0].textContent.trim();
                userName = nodes[2].textContent.trim();
            } else {
                // Fallback for different structures
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

        // Secondary Fallback: Method 1 (Old but retained for older post structures)
        if (userName === "Anonymous" && !userCompany) {
            const articleContainer = document.querySelector('article') || document.querySelector('main');
            const possibleHeaders = articleContainer?.querySelectorAll('.flex.flex-wrap.text-xs.font-semibold.text-gray-700') || [];
            const h1El = document.querySelector('h1');

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

        // Post Type & Widget Extraction
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
                // Try multiple patterns for poll rows
                let optionRows = Array.from(pollContainer.querySelectorAll('div.relative.mb-3, div.relative'));

                // Filter rows that actually look like poll options (text + percentage)
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

                    // Helper to exact text value for a label
                    // Helper to extract text value for a label
                    const extractField = (label) => {
                        // 1. Try finding it as a prefix (Inline value) like "TC: $550K"
                        const prefixNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim().startsWith(label) && el.children.length === 0
                        );
                        if (prefixNodes.length > 0) {
                            return prefixNodes[0].textContent.replace(label, '').trim();
                        }

                        // 2. Try finding the label and getting the value from the previous sibling
                        // Structure: <div>Value</div><div>Label</div>
                        const labelNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim() === label.replace(':', '').trim() // Handle "Base:" vs "Base"
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

            // Calculate expected count based on visible + buttons
            let visibleCount = nestedReplies.length;
            let buttonCount = 0;
            const moreRepliesBtn = Array.from(el.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));
            if (moreRepliesBtn) {
                const match = moreRepliesBtn.innerText.match(/(\d+)/);
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
                all_ids: all_ids
            }
        };
    }, { externalThreadResults: threadResults, scrapeTimeRaw: scrapeTimeRaw.getTime(), formattedScrapeTime: scrapeTime });

    data.debug = { ...data.debug, ...debug_info };

    // Verification: Check if scraped count matches metadata
    const metaCount = parseInt((data.commentsCount || "0").replace(/,/g, ''), 10);
    let scrapedCount = 0;
    const countReplies = (replies) => {
        let count = 0;
        for (const r of replies) {
            count += 1;
            if (r.nested) count += countReplies(r.nested);
        }
        return count;
    };
    scrapedCount = countReplies(data.replies);

    const discrepancy = metaCount - scrapedCount;
    const discrepancyPercent = metaCount > 0 ? (discrepancy / metaCount * 100).toFixed(1) : 0;

    data.debug.verification = {
        metaCount,
        scrapedCount,
        discrepancy,
        discrepancyPercent: `${discrepancyPercent}%`
    };

    if (discrepancy > 0 && discrepancyPercent > 10) {
        console.log(`WARNING: Scraped ${scrapedCount} comments but metadata says ${metaCount}. Missing ${discrepancy} (${discrepancyPercent}%).`);
        console.log("Attempting recovery scroll + one more check for 'View more comments'...");

        // Recovery attempt: scroll to bottom and check for more buttons
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(3000);

        try {
            await page.waitForSelector('button:has-text("View more comments")', { timeout: 5000 });
            console.log("Found additional 'View more comments' button after recovery scroll!");
            // Note: We don't re-run the full loop here, just log for awareness
            // A full re-run would require restructuring; this is a diagnostic
        } catch (e) {
            console.log("No additional buttons found after recovery scroll.");
        }
    } else {
        console.log(`Verification OK: Scraped ${scrapedCount}/${metaCount} comments (${discrepancyPercent}% discrepancy).`);
    }

    // Download images locally
    await downloadAllImages(data, url);

    return { url, ...data };
}

async function startScraping() {
    const argUrl = process.argv[2];
    let urls = [];

    if (argUrl && argUrl.startsWith("http")) {
        urls = [argUrl];
        console.log(`Starting single post extraction (Greedy) for: ${argUrl}`);
    } else {
        if (fs.existsSync(IN_FILE)) {
            urls = fs.readFileSync(IN_FILE, "utf-8").split("\n").filter(u => u.trim());
            console.log(`Starting batch extraction (Greedy) from: ${IN_FILE} (${urls.length} URLs found)`);
        } else {
            console.error(`Input file not found: ${IN_FILE}`);
            process.exit(1);
        }
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (SHOULD_LOGIN) {
        await login(page);
    } else {
        console.log("Skipping login as per configuration.");
    }

    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    for (const url of urls) {
        const identifier = url.split('/').pop() || `post_${Date.now()}`;
        const filePath = `${OUT_DIR}/${identifier}.json`;

        if (fs.existsSync(filePath)) {
            console.log(`Skipping (Already scraped): ${url}`);
            continue;
        }

        try {
            const data = await extractPostData(page, url);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`Saved: ${filePath}`);

        } catch (e) {
            console.error(`Error scraping ${url}:`, e.message);
        }
        await page.waitForTimeout(2000);
    }

    await browser.close();
    console.log("Greedy scraping completed.");
}

const isMain = process.argv[1].endsWith('extract_post_details_greedy.mjs');
if (isMain) {
    startScraping().catch(console.error);
}

export { extractPostData, startScraping };
