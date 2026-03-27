import { chromium } from "playwright";

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const url = "https://www.teamblind.com/post/referrals-hashtags-4-days-h6pkc2it";
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000); // Plenty of time

    // Scroll a bit
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(2000);

    const buttons = await page.evaluate(() => {
        const results = [];
        // Look for anything that might be a button or link
        const elements = document.querySelectorAll('button, a, div[role="button"], span');
        elements.forEach(el => {
            const text = el.innerText.trim();
            if (text && text.length < 100) { // Avoid huge text blocks
                results.push({
                    tag: el.tagName,
                    text: text,
                    id: el.id,
                    className: el.className
                });
            }
        });
        return results;
    });

    // Filter for expansion-like text
    const filtered = buttons.filter(b =>
        b.text.toLowerCase().includes('more') ||
        b.text.toLowerCase().includes('reply') ||
        b.text.toLowerCase().includes('view') ||
        b.text.toLowerCase().includes('show')
    );

    console.log("Filtered buttons:");
    console.log(JSON.stringify(filtered, null, 2));

    await browser.close();
}

run();
