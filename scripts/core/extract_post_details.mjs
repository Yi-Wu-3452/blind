import { chromium } from "playwright";
import fs from "fs";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.resolve(__dirname, "../../data/nvidia_post_urls.txt");
const OUT_DIR = path.resolve(__dirname, "../../data/posts");
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

// Set to true to enable manual login (required for polls/hidden content)
const SHOULD_LOGIN = true;

async function login(page) {
    console.log("Attempting auto-login...");
    await page.goto("https://www.teamblind.com/login");

    try {
        // Wait for email input
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);

        // Click login button
        await page.click('button[type="submit"]');

        console.log("Login form submitted. Waiting for redirection...");

        // Wait until the URL no longer contains 'login' or 'sign-in'
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

async function extractPostData(page, url) {
    console.log(`Processing: ${url}`);
    await page.goto(url, { waitUntil: "networkidle" });

    // Handle "View more comments" (top-level) recursively
    console.log("Loading all top-level comments...");
    let moreCommentsFound = true;
    while (moreCommentsFound) {
        const btn = await page.$('button:has-text("View more comments")');
        if (btn) {
            console.log("Clicking 'View more comments'...");
            try {
                await btn.click();
                await page.waitForTimeout(1500); // Wait for new comments to append
                // Scroll to bottom to ensure the button is in view if it moved
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            } catch (e) {
                moreCommentsFound = false;
            }
        } else {
            moreCommentsFound = false;
        }
    }

    // Handle "View more replies" (nested)
    console.log("Loading visible nested replies...");
    let moreRepliesFound = true;
    let attempts = 0;
    const attemptedIds = new Set();
    const threadResults = {}; // Store replies from focused thread views

    while (moreRepliesFound && attempts < 20) {
        attempts++;
        const buttons = await page.$$('button:has-text("more reply"), button:has-text("more replies"), a:has-text("more reply"), a:has-text("more replies")');
        let clickedInThisIteration = 0;

        for (const btn of buttons) {
            try {
                const btnInfo = await btn.evaluate(node => {
                    const comment = node.closest('div[id^="comment-"]');
                    return {
                        id: comment ? comment.id : null,
                        text: node.innerText.trim(),
                        isLink: node.tagName === 'A' || !!node.getAttribute('href') || !!node.closest('a')
                    };
                });

                const key = btnInfo.id ? `${btnInfo.id}-${btnInfo.text}` : btnInfo.text;
                if (attemptedIds.has(key) || (!btnInfo.id && btnInfo.isLink)) continue;

                attemptedIds.add(key);
                const currentUrl = page.url();

                await btn.click({ timeout: 2000 });
                await page.waitForTimeout(1000);

                if (page.url() !== currentUrl) {
                    console.log(`Detected navigation to focused thread for ${key}. Scraping thread view...`);
                    // Scrape the replies on this focused thread page
                    const threadData = await page.evaluate(() => {
                        const rootComment = document.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
                        const actualId = rootComment ? rootComment.id : null;

                        const extractRepliesRecursive = (rootElement) => {
                            if (!rootElement) return [];

                            // Replies can be in a child pl- div OR a following sibling pl- div
                            let threadContainer = rootElement.querySelector('div[class*="pl-"]');
                            if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) {
                                threadContainer = rootElement.nextElementSibling;
                            }

                            if (!threadContainer) return [];

                            const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                                // Find if there's any other comment DIV between this el and the threadContainer
                                let parent = el.parentElement;
                                while (parent && parent !== threadContainer) {
                                    if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) {
                                        return false; // This is a nested reply, not an immediate child of this threadContainer
                                    }
                                    parent = parent.parentElement;
                                }
                                return true;
                            });
                            return replyElements.map(el => {
                                const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                                return {
                                    userName: header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "",
                                    company: header?.querySelector('a[href^="/company/"]')?.textContent?.trim() || "",
                                    date: header?.querySelector('span.text-gray-600')?.textContent?.trim() || "",
                                    content: el.querySelector('div.whitespace-pre-wrap, p')?.textContent?.trim() || "",
                                    likes: el.querySelector('button[aria-label*="Like"]')?.textContent?.trim() || "0",
                                    images: Array.from(el.querySelectorAll('img[src*="/uploads/atch_img/"]')).map(img => img.src),
                                    nested: extractRepliesRecursive(el)
                                };
                            });
                        };
                        return {
                            id: actualId,
                            replies: rootComment ? extractRepliesRecursive(rootComment) : []
                        };
                    });

                    if (threadData.id) {
                        console.log(`Successfully scraped ${threadData.replies.length} replies for comment ID: ${threadData.id}`);
                        threadResults[threadData.id] = threadData.replies;
                    } else if (btnInfo.id) {
                        // Fallback to the ID from the main page if thread page ID not found
                        threadResults[btnInfo.id] = threadData.replies;
                        threadResults[btnInfo.id.replace('-group', '')] = threadData.replies;
                    }

                    await page.goBack({ waitUntil: "networkidle" });
                    await page.waitForTimeout(1500);
                    clickedInThisIteration++;
                    break;
                }

                clickedInThisIteration++;
            } catch (e) {
                // Ignore stale elements
            }
        }

        if (clickedInThisIteration === 0) {
            moreRepliesFound = false;
        }
    }

    const data = await page.evaluate((externalThreadResults) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";

        // Post Metadata
        const title = getSafeText("h1");
        const content = getSafeText("p.whitespace-pre-wrap.break-words");

        // User Info & Channel [REFINED]
        const channel = getSafeText('a[data-testid="article-preview-channel"]');
        const date = document.querySelector('a[data-testid="article-preview-channel"]')?.parentElement?.querySelector('span')?.textContent?.trim() || "";

        // Find the post author header
        let userCompany = "";
        let userName = "Anonymous";

        // Primary Method: Target the specific OP info container
        const opHeader = document.querySelector('.flex.h-full.items-center.text-xs.text-gray-800');
        if (opHeader) {
            const companyEl = opHeader.querySelector('a[href^="/company/"]');
            userCompany = companyEl?.textContent?.trim() || "";

            // The username is typically a text node after the company link or an SVG separator
            // We extract all text nodes and pick the one that doesn't match common metadata
            const textNodes = Array.from(opHeader.childNodes)
                .filter(node => node.nodeType === 3) // Node.TEXT_NODE
                .map(node => node.textContent.trim())
                .filter(txt => txt.length > 1 && !txt.includes('·'));

            if (textNodes.length > 0) {
                userName = textNodes[0];
            } else {
                // Fallback: use text content minus company
                let fullText = opHeader.textContent.trim();
                if (userCompany && fullText.startsWith(userCompany)) {
                    userName = fullText.replace(userCompany, "").replace(/^[^\w\d]+/, "").trim() || "Anonymous";
                } else {
                    userName = fullText || "Anonymous";
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

        // Counts
        const likes = (document.querySelector('button[aria-label="Like this post"]') || document.querySelector('.icon-like')?.parentElement)?.textContent?.trim() || "0";
        const views = document.querySelector('button[aria-label="Views"]')?.getAttribute('data-count') || "0";
        const commentsCount = (document.querySelector('button[aria-label="Comment on this post"]') || document.querySelector('.icon-comment')?.parentElement)?.textContent?.trim() || "0";

        // Poll Results [DISABLED]
        const poll = null;

        // Related Companies
        const relatedSection = Array.from(document.querySelectorAll('div')).find(d => d.textContent === 'Related Companies')?.parentElement;
        const relatedCompanies = Array.from(relatedSection?.querySelectorAll('a[href^="/company/"]') || []).map(a => ({
            name: a.querySelector('h4')?.textContent?.trim() || "",
            rating: a.querySelector('span.text-sm.font-semibold')?.textContent?.trim() || ""
        }));

        // Related Companies Topics [NEW]
        const topicsSection = Array.from(document.querySelectorAll('div, h3')).find(el => el.textContent === 'Related Companies Topics')?.parentElement;
        const relatedTopics = Array.from(topicsSection?.querySelectorAll('div.pb-2.pt-2') || []).map(group => {
            const companyName = group.querySelector('h4')?.textContent?.trim() || "";
            const links = Array.from(group.querySelectorAll('a.underline')).map(a => ({
                label: a.textContent.trim(),
                url: a.href
            }));
            return { companyName, links };
        });

        // Replies
        const extractReplies = (rootElement) => {
            const commentId = rootElement.id;

            // If we have external thread results for this comment, use them!
            if (commentId && externalThreadResults[commentId]) {
                return externalThreadResults[commentId];
            }

            // Replies can be in a child pl- div OR a following sibling pl- div
            let threadContainer = rootElement.querySelector('div[class*="pl-"]');
            if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) {
                threadContainer = rootElement.nextElementSibling;
            }

            if (!threadContainer) return [];

            // Find all immediate comment blocks in this thread
            const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                // Find if there's any other comment DIV between this el and the threadContainer
                let parent = el.parentElement;
                while (parent && parent !== threadContainer) {
                    if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) {
                        return false; // This is a nested reply
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
                    date: rDate,
                    content: rContent,
                    likes: rLikes,
                    images,
                    nested: extractReplies(el)
                };
            });
        };

        // Find all top-level comment sections
        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
            // Only top-level comments (not inside a thread container)
            return !el.parentElement.closest('div[class*="pl-"]');
        });

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

            // Final fallback check for external results
            if ((!nestedReplies || nestedReplies.length === 0) && commentId && externalThreadResults[commentId]) {
                nestedReplies = externalThreadResults[commentId];
            }

            return {
                userName: rUserName,
                company: rCompany,
                date: rDate,
                content: rContent,
                likes: rLikes,
                images,
                nested: nestedReplies
            };
        }).filter(r => r.company || r.content);

        return { title, content, userName, userCompany, date, channel, likes, views, commentsCount, poll, relatedCompanies, relatedTopics, replies };
    }, threadResults);

    return { url, ...data };
}

async function startScraping() {
    const argUrl = process.argv[2];
    let urls = [];

    if (argUrl && argUrl.startsWith("http")) {
        urls = [argUrl];
        console.log(`Starting single post extraction for: ${argUrl}`);
    } else {
        if (fs.existsSync(IN_FILE)) {
            urls = fs.readFileSync(IN_FILE, "utf-8").split("\n").filter(u => u.trim());
            console.log(`Starting batch extraction from: ${IN_FILE} (${urls.length} URLs found)`);
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
        console.log("Skipping login as per configuration. Some content (polls, etc.) may be missing.");
    }

    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    const allData = [];
    for (const url of urls) {
        try {
            const data = await extractPostData(page, url);

            // Extract identifier from URL (e.g., layoff-confirmed-in-10-hrs-gl81v2i4)
            const identifier = url.split('/').pop() || `post_${Date.now()}`;
            const filePath = `${OUT_DIR}/${identifier}.json`;

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`Saved: ${filePath}`);

            allData.push(data);
        } catch (e) {
            console.error(`Error scraping ${url}:`, e.message);
        }
        await page.waitForTimeout(2000); // Throttling
    }

    await browser.close();
    console.log("Scraping completed.");
}

export { extractPostData, startScraping };

const isMain = process.argv[1].endsWith('extract_post_details.mjs');
if (isMain) {
    startScraping().catch(console.error);
}
