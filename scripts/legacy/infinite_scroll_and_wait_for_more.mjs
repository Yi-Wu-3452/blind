// infinite_scroll_prune_wait_end_rollup.mjs
// Usage: node infinite_scroll_prune_wait_end_rollup.mjs
import { chromium } from "playwright";
import fs from "fs";

const START_URL = "https://www.teamblind.com/search/Nvidia";
const OUT = "nvidia_urls.txt";

// DOM safety
const MAX_IN_DOM = 50;
const PRUNE_COUNT = 40;
// Scroll pause seconds
const SCROLL_PAUSE_MS = 100;

// Scrolling behavior
const SCROLL_STEP_MULT = 4;          // scroll by 2x viewport each step
const NEAR_BOTTOM_THRESHOLD = 900;   // px from bottom to consider "near end"
const BOTTOM_WAIT_TIMEOUT_MS = 15000;

// End detection
const END_MISSES_TO_STOP = 6;

// Roll-up recovery: when bottom-miss happens, scroll up a bit then back down
const ENABLE_ROLLUP_RECOVERY = true;
const ROLLUP_ON_MISS_COUNT = 1;      // trigger roll-up when endMisses hits this value
const ROLL_UP_PX = 1200;
const ROLLUP_SETTLE_MS = 600;

function loadSeen() {
    if (!fs.existsSync(OUT)) return new Set();
    return new Set(fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean));
}
function saveUrl(url) {
    fs.appendFileSync(OUT, url + "\n");
}

async function extractPostHrefs(page) {
    return await page.$$eval("article a[href]", (links) =>
        links
            .map((a) => a.getAttribute("href") || "")
            .filter((h) => h && h.includes("/post/"))
    );
}

async function pruneOldestArticles(page, n) {
    await page.evaluate((count) => {
        const nodes = Array.from(document.querySelectorAll("article"));
        for (let i = 0; i < Math.min(count, nodes.length); i++) nodes[i].remove();
    }, n);
}

async function isNearBottom(page, thresholdPx = 800) {
    return await page.evaluate((threshold) => {
        const doc = document.documentElement;
        const scrollTop = window.scrollY || doc.scrollTop;
        const viewport = window.innerHeight || doc.clientHeight;
        const height = doc.scrollHeight;
        return scrollTop + viewport >= height - threshold;
    }, thresholdPx);
}

async function waitForGrowthAfterBottom(page, timeoutMs = 15000) {
    const prevArticleCount = await page.locator("article").count();
    const prevScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    try {
        await page.waitForFunction(
            ([prevCount, prevHeight]) => {
                const curCount = document.querySelectorAll("article").length;
                const curHeight = document.documentElement.scrollHeight;
                return curCount > prevCount || curHeight > prevHeight;
            },
            [prevArticleCount, prevScrollHeight],
            { timeout: timeoutMs }
        );
        return true;
    } catch {
        return false;
    }
}

async function scrollStep(page) {
    await page.evaluate((mult) => {
        window.scrollBy(0, Math.floor((window.innerHeight || 800) * mult));
    }, SCROLL_STEP_MULT);
}
async function scrollToBottom(page) {
    await page.evaluate(() => {
        const doc = document.documentElement;
        window.scrollTo(0, doc.scrollHeight - window.innerHeight);
    });
}

async function rollUpRecovery(page) {
    // roll up
    await page.evaluate((mult) => {
        window.scrollBy(0, - Math.floor(window.innerHeight || 800) * mult);
    }, SCROLL_STEP_MULT);

    await page.waitForTimeout(ROLLUP_SETTLE_MS);
}

(async () => {
    const seen = loadSeen();

    const browser = await chromium.launch({
        headless: false, // set true once stable
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
            await pruneOldestArticles(page, PRUNE_COUNT);
        }
        await page.waitForTimeout(1000);

        // 3) Scroll
        const nearBottomBefore = await isNearBottom(page, NEAR_BOTTOM_THRESHOLD);
        await scrollToBottom(page);

        await page.waitForTimeout(SCROLL_PAUSE_MS);

        // 4) Only do the heavy wait when near bottom
        if (!nearBottomBefore) {
            await page.waitForTimeout(250);
            continue;
        }

        // 5) Wait for new content; if miss, optionally do roll-up recovery once
        let grew = await waitForGrowthAfterBottom(page, BOTTOM_WAIT_TIMEOUT_MS);


        if (!grew && ENABLE_ROLLUP_RECOVERY && endMisses + 1 === ROLLUP_ON_MISS_COUNT) {
            console.log("  miss -> roll-up recovery jiggle...");
            await rollUpRecovery(page);
            grew = true;

        }

        if (grew) {
            endMisses = 0;
        } else {
            endMisses++;
            console.log(`  hit bottom, no growth (${endMisses}/${END_MISSES_TO_STOP})`);
            if (endMisses >= END_MISSES_TO_STOP) {
                console.log("Likely reached the end (or throttled/gated). Stopping.");
                break;
            }
        }
    }

    await browser.close();
    console.log("Done. URLs saved:", seen.size, "->", OUT);
})().catch((e) => {
    console.error("Script failed:", e);
    process.exit(1);
});
