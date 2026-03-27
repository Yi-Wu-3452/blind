// infinite_scroll_gutting_stable.mjs
// Usage: node infinite_scroll_gutting_stable.mjs
import { chromium } from "playwright";
import fs from "fs";

const START_URL = "https://www.teamblind.com/search/Nvidia";
const OUT = "nvidia_urls.txt";

// DOM safety - increased for stability
// Keep at most 2000 articles with content. Older ones will be "gutted"
const MAX_IN_DOM_CONTENT = 2000;
const GUT_COUNT = 1000;

// Scroll pause milliseconds
const SCROLL_PAUSE_MS = 150;

// Scrolling behavior
const SCROLL_STEP_MULT = 4;
const BOTTOM_WAIT_TIMEOUT_MS = 20000;

// Strict growth requirement
const REQUIRED_NEW_ARTICLES = 20;

// End detection
const END_MISSES_TO_STOP = 6;

// Roll-up recovery
const ENABLE_ROLLUP_RECOVERY = true;
const ROLLUP_ON_MISS_COUNT = 1;
const ROLLUP_SETTLE_MS = 800;

function loadSeen() {
    if (!fs.existsSync(OUT)) return new Set();
    return new Set(fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean));
}
function saveUrl(url) {
    fs.appendFileSync(OUT, url + "\n");
}

async function extractPostHrefs(page) {
    try {
        // Only extract from articles that are NOT gutted
        return await page.$$eval("article:not([data-gutted]) a[href]", (links) =>
            links
                .map((a) => a.getAttribute("href") || "")
                .filter((h) => h && h.includes("/post/"))
        );
    } catch (e) {
        console.error("  extraction failed:", e.message);
        return [];
    }
}

async function gutOldestArticles(page, n) {
    try {
        console.log(`  gutting ${n} oldest articles to keep DOM stable...`);
        await page.evaluate((count) => {
            const nodes = Array.from(document.querySelectorAll("article:not([data-gutted])"));
            for (let i = 0; i < Math.min(count, nodes.length); i++) {
                const node = nodes[i];
                // Lock height to avoid layout shift
                node.style.minHeight = node.offsetHeight + "px";
                node.innerHTML = "";
                node.dataset.gutted = "true";
            }
        }, n);
    } catch (e) {
        console.error("  gutting failed:", e.message);
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
        const finalState = await getPageState(page);
        return finalState.count >= prevState.count + REQUIRED_NEW_ARTICLES;
    }
}

async function scrollToBottom(page) {
    try {
        await page.evaluate(() => {
            const doc = document.documentElement;
            // Scroll slightly up then down to ensure an event is triggered if already at bottom
            window.scrollBy(0, -10);
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

    const cleanup = async () => {
        if (browser) {
            console.log("\nClosing browser gracefully...");
            await browser.close().catch(() => { });
        }
        process.exit();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    browser = await chromium.launch({
        headless: false,
        slowMo: 10,
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
            if (page.isClosed()) break;
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
            const guttedCount = await page.locator("article[data-gutted]").count();
            console.log(
                `loop=${loops} dom=${domCount} (gutted=${guttedCount}) +new=${added} total=${seen.size} misses=${endMisses}`
            );

            // 2) Capture State BEFORE Scrolling
            const prevState = await getPageState(page);

            // 3) Scroll to Bottom
            console.log(`  scrolling (count: ${prevState.count})...`);
            await scrollToBottom(page);
            await page.waitForTimeout(SCROLL_PAUSE_MS);

            // 4) Wait for Strict Growth (at least 20 more)
            console.log(`  waiting for +${REQUIRED_NEW_ARTICLES} articles...`);
            let grew = await waitForGrowth(page, prevState, BOTTOM_WAIT_TIMEOUT_MS);

            // 5) Recovery if no growth
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
                console.log(`  ...growth detected (new: ${afterState.count}, +${afterState.count - prevState.count})`);
            } else {
                endMisses++;
                console.log(`  no sufficient growth (${endMisses}/${END_MISSES_TO_STOP})`);
                if (endMisses >= END_MISSES_TO_STOP) {
                    console.log("Likely reached the end. Stopping.");
                    break;
                }
            }

            // 6) Gutting at the END of the loop
            // Calculate how many articles currently have content
            const activeArticles = await page.evaluate(() => document.querySelectorAll("article:not([data-gutted])").length);
            if (activeArticles > MAX_IN_DOM_CONTENT) {
                await gutOldestArticles(page, GUT_COUNT);
                // No jiggle needed since DOM nodes are still there, but a small wait helps stability
                await page.waitForTimeout(500);
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
