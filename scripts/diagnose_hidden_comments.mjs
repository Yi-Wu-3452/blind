import { chromium } from "playwright";

const url = "https://www.teamblind.com/post/is-nvidia-really-fcked-like-everyone-says-uakgdxh7";
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // Login
    await page.goto("https://www.teamblind.com/login");
    try {
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 15000 });
        console.log("Logged in.");
    } catch (e) {
        console.log("Login failed or skipped.");
    }

    // Go back to post
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // Initial counts (excluding comment-group)
    let comments = await page.$$eval('div[id^="comment-"]:not([id^="comment-group-"])', els => els.length);
    console.log(`Initial visible comments: ${comments}`);

    // Click "View more comments" loop
    let loadMoreVisible = true;
    let attempts = 0;
    while (loadMoreVisible && attempts < 20) {
        const btn = await page.$('button:has-text("View more comments")');
        if (btn) {
            try {
                await btn.click();
                await page.waitForTimeout(2000);
                attempts++;
                const newComments = await page.$$eval('div[id^="comment-"]:not([id^="comment-group-"])', els => els.length);
                console.log(`Clicked 'View more comments' (${attempts}), visible comments: ${newComments}`);
            } catch (e) {
                console.log("Error clicking load more:", e.message);
                loadMoreVisible = false;
            }
        } else {
            console.log("No more 'View more comments' button found.");
            loadMoreVisible = false;
        }
    }

    // Check for other potential buttons
    const allButtons = await page.$$eval('button', btns => btns.map(b => b.innerText.trim()).filter(t => t.length < 50));
    console.log("Other visible buttons:", allButtons);

    // Check for collapsed/hidden comments
    const hiddenComments = await page.$$eval('.hidden, [style*="display: none"]', els => els.length);
    console.log(`Potential hidden elements count: ${hiddenComments}`);

    await browser.close();
})();
