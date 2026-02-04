import { chromium } from "playwright";

const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

async function diagnosePoll() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login first
    console.log("Logging in...");
    await page.goto("https://www.teamblind.com/login");
    await page.fill('input[name="email"]', CREDENTIALS.email);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    const url = "https://www.teamblind.com/post/nvidia-ic5-offer-yay-or-nay-22ovu3vb";
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Click View Result
    console.log("Clicking 'View Result'...");
    const viewResultBtn = await page.$('button:has-text("View Result")');
    if (viewResultBtn) {
        await viewResultBtn.click();
        await page.waitForTimeout(2000);
    }

    const pollInfo = await page.evaluate(() => {
        // After clicking View Result, look for the poll results structure
        const allDivs = document.querySelectorAll('div.rounded-lg.border, div[class*="rounded"]');
        const pollDivs = [];

        for (const div of allDivs) {
            const text = div.textContent || '';
            // Look for percentages which indicate poll results
            if (text.match(/\d+(\.\d+)?%/) || text.toLowerCase().includes('vote')) {
                pollDivs.push({
                    class: div.className?.slice(0, 200),
                    html: div.outerHTML?.slice(0, 1500),
                    innerText: div.innerText?.slice(0, 500)
                });
            }
        }

        // Also look for progress bars or percentage displays
        const progressBars = document.querySelectorAll('[role="progressbar"], div[style*="width"]');
        const progressInfo = Array.from(progressBars).slice(0, 10).map(el => ({
            tag: el.tagName,
            class: el.className,
            style: el.getAttribute('style'),
            text: el.textContent?.slice(0, 100)
        }));

        return {
            pollDivs: pollDivs.slice(0, 3),
            progressBars: progressInfo
        };
    });

    console.log("\n=== POLL AFTER VIEW RESULT ===\n");
    console.log("Poll-related divs:", JSON.stringify(pollInfo.pollDivs, null, 2));
    console.log("\nProgress bars:", JSON.stringify(pollInfo.progressBars, null, 2));

    await browser.close();
}

diagnosePoll().catch(console.error);
