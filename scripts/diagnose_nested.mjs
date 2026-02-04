
import { chromium } from "playwright";

async function diagnose() {
    const browser = await chromium.launch({ headless: true }); // Headless true for speed/no-gui
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    const url = "https://www.teamblind.com/post/beware-of-nvidia-recruiters-scam-kjgigd2u";

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for comments to appear
    try {
        await page.waitForSelector('div[id^="comment-"]', { timeout: 10000 });
        console.log("Comments detected.");
    } catch (e) {
        console.log("No comments detected or timeout.");
        // Maybe needs scroll
    }

    // Scroll a bit
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);

    const structure = await page.evaluate(() => {
        const comments = Array.from(document.querySelectorAll('div[id^="comment-"]'));

        return comments.map(c => {
            const id = c.id;
            const parent = c.parentElement;
            const parentClasses = parent ? parent.className : '';
            const classes = c.className;
            const text = c.innerText.substring(0, 30).replace(/\n/g, ' ');

            // Check direct text content if any
            // And identifying feature of nested vs top level

            return {
                id,
                text,
                parentTag: parent ? parent.tagName : null,
                parentClasses,
                classes,
                isPl: parentClasses.includes('pl-'),
                hierarchy: getHierarchy(c)
            };
        });

        function getHierarchy(el) {
            let path = [];
            let curr = el.parentElement;
            while (curr && curr.tagName !== 'BODY') {
                if (curr.id && curr.id.startsWith('comment-')) {
                    path.push(curr.id);
                }
                curr = curr.parentElement;
            }
            return path;
        }
    });

    console.log(JSON.stringify(structure, null, 2));

    await browser.close();
}

diagnose().catch(console.error);
