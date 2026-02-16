import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
const args = process.argv.slice(2);
const companyName = args.find(arg => arg.startsWith("--company="))?.split("=")[1];
const targetUrl = args.find(arg => arg.startsWith("--url="))?.split("=")[1];
let outFile = args.find(arg => arg.startsWith("--out="))?.split("=")[1];

function printUsage() {
    console.log("Usage:");
    console.log("  node scripts/core/collect_company_urls.mjs --company=<CompanyName> [--out=<output_file>]");
    console.log("  node scripts/core/collect_company_urls.mjs --url=<TargetURL> [--out=<output_file>]");
    console.log("\nExamples:");
    console.log("  node scripts/core/collect_company_urls.mjs --company=Fox");
    console.log("  node scripts/core/collect_company_urls.mjs --url=https://www.teamblind.com/company/Fox/posts");
}

if (!companyName && !targetUrl) {
    console.error("Error: Please provide either --company or --url.");
    printUsage();
    process.exit(1);
}

const COMPANY_POSTS_URL = targetUrl || `https://www.teamblind.com/company/${companyName}/posts`;

if (!outFile) {
    const name = companyName || "company_posts";
    outFile = path.resolve(__dirname, `../../data/${name.toLowerCase()}_post_urls.txt`);
} else {
    // Resolve relative path if provided
    if (!path.isAbsolute(outFile)) {
        outFile = path.resolve(process.cwd(), outFile);
    }
}

async function collectUrls() {
    // Use a unique profile for this run to avoid locking issues
    const runId = Date.now().toString();
    const userDataDir = path.resolve(__dirname, `../../browser_profile_collector_${runId}`);
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    // Ensure output directory exists
    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    console.log(`🚀 Launching Scraper (System Chrome, No Stealth).`);
    console.log(`🎯 Target URL: ${COMPANY_POSTS_URL}`);
    console.log(`📂 Output File: ${outFile}`);
    console.log(`📂 Profile: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        // channel: 'chrome', // Use bundled chromium instead of system chrome for stability
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // '--disable-infobars', // removing this just in case
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--window-size=1280,800',
            // '--user-agent=...' // Let playwright set default UA or use a simpler one if needed
        ],
        viewport: null
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    let currentPage = 1;
    const seenUrls = new Set();
    if (fs.existsSync(outFile)) {
        fs.readFileSync(outFile, "utf-8").split("\n").forEach(url => {
            if (url.trim()) seenUrls.add(url.trim());
        });
    }

    while (true) {
        console.log(`Fetching page ${currentPage}...`);
        const pageUrl = `${COMPANY_POSTS_URL}?page=${currentPage}`;

        try {
            await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (e) {
            console.error(`Error navigating to ${pageUrl}: ${e.message}`);
            console.log("Retrying once...");
            await page.reload({ waitUntil: "domcontentloaded" });
        }

        // Wait for potential dynamic content
        try {
            await page.waitForSelector("a[href*='/post/']", { timeout: 5000 });
        } catch (e) {
            console.log("Timeout waiting for post links. Page might be empty or fully loaded via JS.");
            const screenshotPath = path.resolve(outDir, `error_page_${currentPage}.png`);
            await page.screenshot({ path: screenshotPath });
            console.log(`Saved screenshot to ${screenshotPath}`);
        }

        const urls = await page.$$eval("a[href*='/post/']", anchors => {
            return anchors.map(a => a.href);
        });

        if (urls.length === 0) {
            console.log("No post links found on this page. Stopping.");
            break;
        }

        let newUrlsFound = false;
        for (const url of urls) {
            const cleanUrl = url.split("?")[0]; // Remove query params
            if (!seenUrls.has(cleanUrl)) {
                seenUrls.add(cleanUrl);
                fs.appendFileSync(outFile, cleanUrl + "\n");
                console.log(`+ ${cleanUrl}`);
                newUrlsFound = true;
            }
        }

        console.log(`Page ${currentPage}: Found ${urls.length} links, ${newUrlsFound ? "some new" : "no new"} URLs.`);

        if (!newUrlsFound && currentPage > 1) {
            console.log("No new URLs found on this page. Stopping to avoid duplicates/loops.");
            break;
        }

        // Check for redirect back to first page or other pagination anomalies
        const currentUrl = page.url();
        if (currentPage > 1 && !currentUrl.includes(`page=${currentPage}`)) {
            console.log("Redirected away from requested page. Assuming end of pagination.");
            break;
        }

        currentPage++;

        // Random delay between 2-5 seconds
        const delay = Math.floor(Math.random() * 3000) + 2000;
        await page.waitForTimeout(delay);
    }

    await context.close();
    console.log(`Finished. Total unique URLs: ${seenUrls.size}`);
}

collectUrls().catch(console.error);
