// infinite_scroll.mjs
import { chromium } from "playwright";
import fs from "fs";

const START_URL = "https://www.teamblind.com/search/Nvidia";
const OUT = "nvidia_urls.txt";

const MAX_IN_DOM = 100;
const PRUNE_COUNT = 80;
const SCROLL_PAUSE_MS = 2000;
const MAX_NO_NEW_LOOPS = 25;

function loadSeen() {
    if (!fs.existsSync(OUT)) return new Set();
    return new Set(fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean));
}

function saveUrl(url) {
    fs.appendFileSync(OUT, url + "\n");
}

async function extractUrls(page) {
    // Broader: take ANY link inside articles, then filter to /post/ later
    return await page.$$eval("article a[href]", (links) =>
        links.map((a) => a.getAttribute("href") || "").filter(Boolean)
    );
}

async function pruneOldest(page, n) {
    await page.evaluate((count) => {
        const nodes = Array.from(document.querySelectorAll("article"));
        for (let i = 0; i < Math.min(count, nodes.length); i++) nodes[i].remove();
    }, n);
}

async function scrollStep(page) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 2)));
}

(async () => {
    const seen = loadSeen();

    const browser = await chromium.launch({ headless: false, slowMo: 30 });
    const context = await browser.newContext();

    await context.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (["image", "media", "font"].includes(t)) return route.abort();
        route.continue();
    });

    const page = await context.newPage();

    console.log("START_URL type:", typeof START_URL, "value:", START_URL);
    await page.goto(START_URL, { waitUntil: "domcontentloaded" });

    let loops = 0;
    let noNewLoops = 0;

    while (noNewLoops < MAX_NO_NEW_LOOPS) {
        loops++;

        const hrefs = await extractUrls(page);

        let added = 0;
        for (const href of hrefs) {
            // keep only post links
            if (!href.includes("/post/")) continue;

            const abs = href.startsWith("http")
                ? href
                : new URL(href, START_URL).toString();

            if (seen.has(abs)) continue;

            seen.add(abs);
            saveUrl(abs);
            added++;
        }

        if (added === 0) noNewLoops++;
        else noNewLoops = 0;

        const domCount = await page.locator("article").count();
        console.log(`loop=${loops} dom=${domCount} +new=${added} total=${seen.size}`);

        if (domCount > MAX_IN_DOM) await pruneOldest(page, PRUNE_COUNT);

        await scrollStep(page);
        await page.waitForTimeout(SCROLL_PAUSE_MS);
    }

    await browser.close();
    console.log("Done. URLs saved:", seen.size);
})().catch((e) => {
    console.error("Script failed:", e);
    process.exit(1);
});
