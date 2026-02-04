import { chromium } from "playwright";

const URL = "https://www.teamblind.com/post/is-nvidia-really-fcked-like-everyone-says-uakgdxh7";
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Navigating to login...");
    await page.goto("https://www.teamblind.com/login");
    await page.fill('input[name="email"]', CREDENTIALS.email);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');

    console.log("Waiting for login...");
    try {
        await page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 15000 });
        console.log("Logged in.");
    } catch (e) {
        console.log("Login wait timed out, proceeding anyway (might need manual check)");
    }

    console.log(`Navigating to target post: ${URL}`);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Initial check
    console.log("Initial page content length:", await page.content().then(c => c.length));

    // Try to find a thread expansion button
    // "more replies" or "View X more replies"
    console.log("Searching for expansion buttons...");
    // Only target the specific type of button that triggers the 'navigation' usually
    const selector = 'button:has-text("more repl"), a:has-text("more repl")';

    const buttons = await page.$$(selector);
    console.log(`Found ${buttons.length} expansion buttons.`);

    if (buttons.length > 0) {
        const btn = buttons[0];
        const text = await btn.innerText();
        console.log(`Clicking button: "${text}"`);

        const beforeUrl = page.url();
        await btn.click();

        console.log("Clicked. Waiting for potential navigation or DOM change...");
        await page.waitForTimeout(5000);

        const afterUrl = page.url();
        console.log(`URL change? ${beforeUrl !== afterUrl}`);
        console.log(`Current URL: ${afterUrl}`);

        const contentLength = await page.content().then(c => c.length);
        console.log(`Page content length: ${contentLength}`);

        const bodyEmpty = await page.evaluate(() => document.body.innerText.trim().length === 0);
        console.log(`Is body text empty? ${bodyEmpty}`);

        if (contentLength < 5000 || bodyEmpty) {
            console.log("BLANK PAGE DETECTED!");
            // Dump some HTML or state
            console.log("Title:", await page.title());
        } else {
            console.log("Page seems to have content.");
        }
    } else {
        console.log("No expansion buttons found immediately. Scrolling...");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        // Retry logic could go here
    }

    console.log("Keeping browser open for 60 seconds for manual inspection...");
    await page.waitForTimeout(60000);

    await browser.close();
}

run().catch(console.error);
