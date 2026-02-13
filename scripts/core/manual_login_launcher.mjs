import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Apply stealth plugin
chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function launchManualLogin() {
    const userDataDir = path.resolve(__dirname, "../../browser_profile");
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`🚀 Launching browser for MANUAL LOGIN (Stealth Mode).`);
    console.log(`📂 Profile: ${userDataDir}`);
    console.log(`👉 Please log in to TeamBlind in the browser window.`);
    console.log(`👉 When you are done and see the home page, you can close the browser or press Ctrl+C here.`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome', // Use system Chrome
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
            '--window-size=1280,800',
            '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"'
        ],
        viewport: null // Let user resize
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.goto("https://www.teamblind.com/sign-in");

    // Keep it open indefinitely until user closes it
    await new Promise(() => { });
}

launchManualLogin().catch(console.error);
