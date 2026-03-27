// debug_blind_page500.mjs
import { chromium } from "playwright";

const URL = "https://www.teamblind.com/company/Apple/posts?page=500";

function looksLikePostsRequest(url) {
    // Blind is a Next.js site; posts list often comes via RSC fetches using `_rsc=...`
    // or via an API endpoint. We match both patterns.
    return (
        url.includes("/company/Apple/posts") ||
        url.includes("_rsc=") ||
        url.includes("/api/") ||
        url.toLowerCase().includes("posts")
    );
}

const run = async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        // If you're logged in in Chrome and want to reuse cookies,
        // export them to a storageState.json and uncomment the next line:
        // storageState: "storageState.json",
    });

    const page = await context.newPage();

    page.on("console", (msg) => {
        console.log(`[console:${msg.type()}] ${msg.text()}`);
    });

    page.on("pageerror", (err) => {
        console.log(`[pageerror] ${err.message}`);
    });

    page.on("requestfailed", (req) => {
        console.log(`[requestfailed] ${req.url()} -> ${req.failure()?.errorText}`);
    });

    page.on("response", async (res) => {
        const url = res.url();
        if (!looksLikePostsRequest(url)) return;

        const status = res.status();
        const ct = res.headers()["content-type"] || "";
        // Only peek small bodies to avoid exploding your terminal
        let bodyPreview = "";
        try {
            const txt = await res.text();
            bodyPreview = txt.slice(0, 400).replace(/\s+/g, " ");
            console.log(
                `\n[response] ${status} ${ct}\n  ${url}\n  preview: ${bodyPreview}\n  len: ${txt.length}\n`
            );
        } catch (e) {
            console.log(`\n[response] ${status} ${ct}\n  ${url}\n  (no text body)\n`);
        }
    });

    console.log("Navigating:", URL);
    await page.goto(URL, { waitUntil: "networkidle" });

    // Quick DOM check: how many post cards are actually rendered?
    // (You may need to tweak the selector depending on Blind's markup changes.)
    const possiblePostSelectors = [
        '[data-testid*="post"]',
        'a[href*="/post/"]',
        'article',
    ];

    for (const sel of possiblePostSelectors) {
        const count = await page.locator(sel).count();
        console.log(`[dom] selector "${sel}" -> count = ${count}`);
    }

    // Keep browser open so you can inspect Network tab too
    console.log("Done. Close the browser to exit.");
    await page.waitForTimeout(10_000_000);
};

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
