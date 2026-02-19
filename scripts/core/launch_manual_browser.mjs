import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const targetUrl = args.find(arg => arg.startsWith("--url="))?.split("=")[1] || "https://www.teamblind.com";

const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

// Override with second_account.txt if exists
const credPath = path.resolve(__dirname, "../../second_account.txt");
if (fs.existsSync(credPath)) {
    const lines = fs.readFileSync(credPath, "utf-8").split("\n");
    CREDENTIALS.email = lines[0]?.trim() || CREDENTIALS.email;
    CREDENTIALS.password = lines[1]?.trim() || CREDENTIALS.password;
    console.log(`🔑 Using credentials from second_account.txt: ${CREDENTIALS.email}`);
}

async function launchBrowser() {
    // Use the same profile directory as the scraper
    const userDataDir = path.resolve(__dirname, `../../browser_profile`);

    if (!fs.existsSync(userDataDir)) {
        console.log("⚠️ No existing browser profile found at:", userDataDir);
        console.log("   Creating a new one...");
        fs.mkdirSync(userDataDir, { recursive: true });
    } else {
        console.log("📂 Using existing browser profile at:", userDataDir);
    }

    console.log(`🚀 Launching Browser in HEADED mode...`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Explicitly false for manual viewing
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--window-size=1400,900',
        ],
        viewport: null
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log(`🔗 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    // Check login status
    const currentUrl = page.url();
    if (!currentUrl.includes("/login") && !currentUrl.includes("/sign-in") && !currentUrl.includes("/login-required")) {
        console.log(`✅ You appear to be logged in.`);
    } else {
        console.log(`ℹ Not logged in. Attempting to pre-fill credentials...`);
        try {
            const emailSelector = 'input[name="email"], input[type="email"], input[placeholder*="Email" i]';
            const passwordSelector = 'input[name="password"], input[type="password"], input[placeholder*="Password" i]';

            await page.waitForSelector(emailSelector, { timeout: 5000 });
            await page.locator(emailSelector).first().fill(CREDENTIALS.email);
            await page.locator(passwordSelector).first().fill(CREDENTIALS.password);
            console.log(`   ✅ Credentials filled. Please click Sign In manually.`);
        } catch (e) {
            console.log(`   ⚠️ Could not auto-fill credentials (form mismatch or already filled).`);
        }
    }

    console.log("\n🛑 SCRIPT PAUSED. The browser is open for your manual inspection.");
    console.log("   Press Ctrl+C in the terminal to close the browser and exit the script.");

    // Keep the script running forever until user kills it
    await new Promise(() => { });
}

launchBrowser().catch(console.error);
