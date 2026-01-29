// infinite_scroll_wait_always.mjs
// Usage: node infinite_scroll_wait_always.mjs
import { chromium } from "playwright";
import fs from "fs";

const START_URL = "https://www.teamblind.com/search/Nvidia";
const OUT = "nvidia_urls.txt";

// DOM safety
const MAX_IN_DOM = 50;
const PRUNE_COUNT = 40;
// Scroll pause milliseconds
const SCROLL_PAUSE_MS = 100;

// Scrolling behavior
const SCROLL_STEP_MULT = 4;          // scroll by 4x viewport each step
const BOTTOM_WAIT_TIMEOUT_MS = 20000; // slightly longer to allow for 20 articles

// Strict growth requirement
const REQUIRED_NEW_ARTICLES = 20;

// End detection
const END_MISSES_TO_STOP = 6;

// Roll-up recovery
const ENABLE_ROLLUP_RECOVERY = true;
const ROLLUP_ON_MISS_COUNT = 1;
const ROLLUP_SETTLE_MS = 600;

function loadSeen() {
    if (!fs.existsSync(OUT)) return new Set();
    return new Set(fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean));
}
function saveUrl(url) {
    fs.appendFileSync(OUT, url + "\n");
}

async function extractPostHrefs(page) {
    try {
        return await page.$$eval("article a[href]", (links) =>
            links
                .map((a) => a.getAttribute("href") || "")
                .filter((h) => h && h.includes("/post/"))
        );
    } catch (e) {
        console.error("  extraction failed:", e.message);
        return [];
    }
}

async function pruneOldestArticles(page, n) {
    try {
        await page.evaluate((count) => {
            const nodes = Array.from(document.querySelectorAll("article"));
            for (let i = 0; i < Math.min(count, nodes.length); i++) nodes[i].remove();
        }, n);
    } catch (e) {
        console.error("  pruning failed:", e.message);
    }
}

async function getPageState(page) {
    try {
        return await page.evaluate(() => {
            return {
                count: document.querySelectorAll("article").length,
                height: document.documentElement.scrollHeight
            };
        });
    } catch (e) {
        return { count: 0, height: 0 };
    }
}

async function waitForGrowth(page, prevState, timeoutMs = 20000) {
    try {
        await page.waitForFunction(
            ([prevCount, requiredNew]) => {
                const curCount = document.querySelectorAll("article").length;
                return curCount >= prevCount + requiredNew;
            },
            [prevState.count, REQUIRED_NEW_ARTICLES],
            { timeout: timeoutMs }
        );
        return true;
    } catch {
        // Double check one last time in case it just missed the threshold by a bit or timeout hit
        const finalState = await getPageState(page);
        return finalState.count >= prevState.count + REQUIRED_NEW_ARTICLES;
    }
}

async function scrollToBottom(page) {
    try {
        await page.evaluate(() => {
            const doc = document.documentElement;
            window.scrollTo(0, doc.scrollHeight - window.innerHeight);
        });
    } catch (e) {
        console.error("  scroll failed:", e.message);
    }
}

async function rollUpRecovery(page) {
    try {
        if (page.isClosed()) return;
        await page.evaluate((mult) => {
            window.scrollBy(0, - Math.floor(window.innerHeight || 800) * mult);
        }, SCROLL_STEP_MULT);
        await page.waitForTimeout(ROLLUP_SETTLE_MS);
    } catch (e) {
        console.error("  roll-up recovery failed:", e.message);
    }
}

(async () => {
    const seen = loadSeen();
    let browser;

    // Clean exit handlers
    const cleanup = async () => {
        if (browser) {
            console.log("\nClosing browser...");
            await browser.close().catch(() => { });
        }
        process.exit();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    browser = await chromium.launch({
        headless: false,
        slowMo: 15,
    });

    const context = await browser.newContext();

    // Block heavy resources
    await context.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (["image", "media", "font"].includes(t)) return route.abort();
        route.continue();
    });

    const page = await context.newPage();
    console.log("Go:", START_URL);
    await page.goto(START_URL, { waitUntil: "domcontentloaded" });

    let loops = 0;
    let endMisses = 0;

    while (true) {
        try {
            if (page.isClosed()) {
                console.log("Page was closed. Exiting loop.");
                break;
            }
            loops++;

            // 1) Extract + save URLs
            const hrefs = await extractPostHrefs(page);
            let added = 0;

            for (const href of hrefs) {
                const abs = href.startsWith("http") ? href : new URL(href, START_URL).toString();
                if (seen.has(abs)) continue;
                seen.add(abs);
                saveUrl(abs);
                added++;
            }

            const domCount = await page.locator("article").count();
            console.log(
                `loop=${loops} dom=${domCount} +new=${added} total=${seen.size} endMisses=${endMisses}`
            );

            // 2) Prune DOM
            if (domCount > MAX_IN_DOM) {
                console.log(`  pruning ${PRUNE_COUNT} articles...`);
                await pruneOldestArticles(page, PRUNE_COUNT);
                // Pause slightly after pruning for DOM to settle
                await page.waitForTimeout(500);
            }

            // 3) Capture State BEFORE Scrolling
            const prevState = await getPageState(page);

            // 4) Scroll to Bottom
            console.log(`  scrolling to bottom (current count: ${prevState.count})...`);
            await scrollToBottom(page);
            await page.waitForTimeout(SCROLL_PAUSE_MS);

            // 5) Wait for EXACTLY (at least) 20 more articles
            console.log(`  waiting for +${REQUIRED_NEW_ARTICLES} articles...`);
            let grew = await waitForGrowth(page, prevState, BOTTOM_WAIT_TIMEOUT_MS);

            // 6) Recovery if no growth
            if (!grew && ENABLE_ROLLUP_RECOVERY && endMisses + 1 === ROLLUP_ON_MISS_COUNT) {
                console.log("  miss -> roll-up recovery jiggle...");
                await rollUpRecovery(page);

                const stateAfterJiggle = await getPageState(page);
                await scrollToBottom(page);
                grew = await waitForGrowth(page, stateAfterJiggle, BOTTOM_WAIT_TIMEOUT_MS);
            }

            if (grew) {
                endMisses = 0;
                const afterState = await getPageState(page);
                console.log(`  ...content grew (new count: ${afterState.count}, +${afterState.count - prevState.count})`);
            } else {
                endMisses++;
                console.log(`  hit bottom, no sufficient growth (${endMisses}/${END_MISSES_TO_STOP})`);
                if (endMisses >= END_MISSES_TO_STOP) {
                    console.log("Likely reached the end (or throttled/gated). Stopping.");
                    break;
                }
            }
        } catch (e) {
            console.error(`Error in loop ${loops}:`, e.message);
            if (e.message.includes("closed")) break;
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    await cleanup();
})().catch((e) => {
    console.error("Script failed:", e);
    process.exit(1);
});
