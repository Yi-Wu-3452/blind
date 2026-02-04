
import { chromium } from "playwright";

async function diagnose() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    const url = "https://www.teamblind.com/post/beware-of-nvidia-recruiters-scam-kjgigd2u";

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
        await page.waitForSelector('#comment-group-49353360', { timeout: 15000 });
        console.log("Found target group.");
    } catch (e) {
        console.log("Target group not found. Dumping first available group.");
    }

    const structure = await page.evaluate(() => {
        const target = document.querySelector('#comment-group-49353360') || document.querySelector('div[id^="comment-group-"]');
        if (!target) return "No comment group found";

        function serialize(el, depth = 0) {
            const indent = "  ".repeat(depth);
            let str = `${indent}<${el.tagName.toLowerCase()}`;
            if (el.id) str += ` id="${el.id}"`;
            if (el.className) str += ` class="${el.className}"`;
            str += ">";

            // Text content trace
            const directText = Array.from(el.childNodes)
                .filter(n => n.nodeType === 3 && n.textContent.trim().length > 0)
                .map(n => n.textContent.trim().substring(0, 20))
                .join(" | ");
            if (directText) str += ` (Text: ${directText})`;

            str += "\n";

            for (const child of el.children) {
                str += serialize(child, depth + 1);
            }
            // str += `${indent}</${el.tagName.toLowerCase()}>\n`;
            return str;
        }

        return serialize(target);
    });

    console.log(structure);
    await browser.close();
}

diagnose().catch(console.error);
