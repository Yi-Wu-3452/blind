import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

chromium.use(stealth());

const url = "https://www.teamblind.com/post/referral-request-for-product-management-sp7gccup";

async function debug() {
    console.log(`Debugging: ${url}`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(5000); // Give it time to load content

        const info = await page.evaluate(() => {
            const result = {
                title: document.querySelector('h1')?.innerText,
                commentCount: document.querySelectorAll('div[id^="comment-"]').length,
                potentialButtons: []
            };

            const allClickables = document.querySelectorAll('button, a, div[role="button"]');
            allClickables.forEach(el => {
                const text = el.innerText.trim();
                if (text && (text.toLowerCase().includes('more') || text.toLowerCase().includes('view') || text.toLowerCase().includes('comment'))) {
                    result.potentialButtons.push({
                        tag: el.tagName,
                        text: text,
                        id: el.id,
                        className: el.className,
                        role: el.getAttribute('role'),
                        isVisible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
                    });
                }
            });
            return result;
        });

        console.log("--- DEBUG INFO ---");
        console.log(JSON.stringify(info, null, 2));
        console.log("------------------");

        await page.screenshot({ path: "debug_screenshot.png", fullPage: true });

    } catch (e) {
        console.error("Debug failed:", e.message);
    } finally {
        await browser.close();
    }
}

debug();
