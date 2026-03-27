import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Apply stealth plugin
chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_POSTS_URL = "https://www.teamblind.com/company/NVIDIA/posts/nvidia-offer";
const OUT_FILE = path.resolve(__dirname, "../../data/nvidia_offer_post_urls.txt");

async function collectUrls() {
    const userDataDir = path.resolve(__dirname, "../../browser_profile");
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`🚀 Launching NVIDIA Scraper (Stealth + System Chrome).`);
    console.log(`📂 Profile: ${userDataDir}`);

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
        viewport: null
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    let currentPage = 1;
    const seenUrls = new Set();
    if (fs.existsSync(OUT_FILE)) {
        fs.readFileSync(OUT_FILE, "utf-8").split("\n").forEach(url => {
            if (url.trim()) seenUrls.add(url.trim());
        });
    }

    while (true) {
        console.log(`Fetching page ${currentPage}...`);
        await page.goto(`${COMPANY_POSTS_URL}?page=${currentPage}`, { waitUntil: "networkidle" });

        const urls = await page.$$eval("a[href*='/post/']", anchors => {
            return anchors.map(a => a.href);
        });

        if (urls.length === 0) {
            console.log("No more posts found. Stopping.");
            break;
        }

        let newUrlsFound = false;
        for (const url of urls) {
            const cleanUrl = url.split("?")[0]; // Remove query params
            if (!seenUrls.has(cleanUrl)) {
                seenUrls.add(cleanUrl);
                fs.appendFileSync(OUT_FILE, cleanUrl + "\n");
                newUrlsFound = true;
            }
        }

        if (!newUrlsFound && currentPage > 1) {
            // If no new URLs found on a page other than the first, we might be at the end
            // or we've already scraped these. For now, let's keep going a bit or stop.
            // Blind pagination can be tricky, sometimes it just repeats the last page.
            console.log("No new URLs found on this page. Stopping to avoid duplicates/loops.");
            break;
        }

        currentPage++;
        await page.waitForTimeout(1000); // Respectful delay
    }

    await context.close();
    console.log(`Finished. Total unique URLs: ${seenUrls.size}`);
}

collectUrls().catch(console.error);
