import { chromium } from "playwright";
import fs from "fs";

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const url = "https://www.teamblind.com/post/referrals-hashtags-4-days-h6pkc2it";
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000); // Wait for content

    // Scroll to bottom to load all comments
    console.log("Scrolling to load comments...");
    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(1000);
    }

    const buttons = await page.evaluate(() => {
        const results = [];
        const allClickables = document.querySelectorAll('button, a');
        allClickables.forEach(el => {
            const text = el.innerText.trim();
            if (text && (
                text.toLowerCase().includes('more reply') ||
                text.toLowerCase().includes('more replies') ||
                text.toLowerCase().includes('show more') ||
                text.toLowerCase().includes('view') ||
                text.toLowerCase().includes('reply')
            )) {
                results.push({
                    tag: el.tagName,
                    text: text,
                    className: el.className,
                    id: el.id,
                    parentId: el.closest('div[id^="comment-"]')?.id || 'none'
                });
            }
        });
        return results;
    });

    console.log("Expansion candidates found:");
    console.log(JSON.stringify(buttons, null, 2));

    await browser.close();
}

run();
