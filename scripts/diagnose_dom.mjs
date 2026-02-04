import { chromium } from "playwright";

async function diagnose() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    const url = "https://www.teamblind.com/post/is-nvidia-really-fcked-like-everyone-says-uakgdxh7";

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle" });

    // Wait a bit for dynamic content
    await page.waitForTimeout(3000);

    const stats = await page.evaluate(() => {
        const allDivs = Array.from(document.querySelectorAll('div'));
        const commentDivs = allDivs.filter(d => d.id && d.id.startsWith('comment-'));
        const viewMoreBtn = document.querySelector('button:has-text("View more comments")');

        return {
            totalDivs: allDivs.length,
            commentDivIds: commentDivs.map(d => d.id),
            viewMoreBtnExists: !!viewMoreBtn,
            viewMoreBtnText: viewMoreBtn?.textContent
        };
    });

    console.log("Stats:", JSON.stringify(stats, null, 2));

    await browser.close();
}

diagnose().catch(console.error);
