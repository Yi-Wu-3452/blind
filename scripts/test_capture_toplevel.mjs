import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractPostData, dismissBlockers, downloadAllImages } from "./core/extract_post_details_optimized.mjs";

const useStealth = !process.argv.includes("--no-stealth");
if (useStealth) chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Collect URLs from positional args and/or --file flag
const fileFlag = process.argv.find(a => a.startsWith("--file="));
const URLS = [
    ...process.argv.slice(2).filter(a => a.startsWith("http")),
    ...(fileFlag
        ? fs.readFileSync(path.resolve(fileFlag.split("=")[1]), "utf-8")
            .split("\n").map(l => l.trim()).filter(l => l.startsWith("http"))
        : [])
];
if (URLS.length === 0) {
    console.error("Usage: node test_capture_toplevel.mjs <url1> [url2 ...] [--file=urls.txt] [--snapshot] [--no-block] [--no-stealth]");
    process.exit(1);
}
const useSnapshot = process.argv.includes("--snapshot");
const debugMode = process.argv.includes("--debug");
const reusePage = process.argv.includes("--reuse-page");
const newTab = process.argv.includes("--new-tab");
const newBrowser = process.argv.includes("--new-browser");

const outDirFlag = process.argv.find(a => a.startsWith("--out-dir="));
const OUT_DIR = outDirFlag
    ? path.resolve(outDirFlag.split("=")[1])
    : path.resolve(__dirname, "../data/test_output");
const LOG_DIR = path.resolve(OUT_DIR, "logs");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function createLogger(logFile) {
    // Clear previous log
    fs.writeFileSync(logFile, "");
    return {
        log: (...args) => {
            const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            const timestamp = new Date().toISOString();
            const line = `[${timestamp}] ${message}\n`;
            process.stdout.write(line);
            try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
        },
        error: (...args) => {
            const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            const timestamp = new Date().toISOString();
            const line = `[${timestamp}] ERROR: ${message}\n`;
            process.stderr.write(line);
            try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
        }
    };
}

async function launchBrowser() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Block unnecessary resources to speed up page loads (disable with --no-block)
    if (!process.argv.includes("--no-block")) {
        await context.route('**/*', (route) => {
            const url = route.request().url();
            if (url.includes('google-analytics') ||
                url.includes('googletagmanager') ||
                url.includes('facebook.com/tr')) {
                route.abort();
            } else {
                route.continue();
            }
        });
    }

    return { browser, context };
}

(async () => {
    let { browser, context } = await launchBrowser();

    const mode = newBrowser ? 'new-browser' : reusePage ? 'reuse-page' : newTab ? 'new-tab' : 'default';
    console.log(`\n📋 Processing ${URLS.length} URL(s)... (mode: ${mode})\n`);

    // In reuse-page mode, create one page up front
    let sharedPage = reusePage ? await context.newPage() : null;
    // In new-tab mode, track the previous page to close after the new one is ready
    let prevPage = null;

    for (let i = 0; i < URLS.length; i++) {
        const url = URLS[i];
        const slug = url.split("/").pop();
        const logFile = path.join(LOG_DIR, `${slug}.log`);
        const logger = createLogger(logFile);

        console.log(`\n[${i + 1}/${URLS.length}] Processing: ${slug}`);

        // In new-browser mode, launch a fresh browser for each URL
        if (newBrowser && i > 0) {
            await browser.close().catch(() => { });
            ({ browser, context } = await launchBrowser());
        }

        // Check if browser is still alive; relaunch if needed
        if (!browser.isConnected()) {
            console.log(`🔄 Browser died — relaunching...`);
            try { await browser.close(); } catch (_) { /* already dead */ }
            ({ browser, context } = await launchBrowser());
            if (reusePage) sharedPage = await context.newPage();
            prevPage = null;
        }

        let page;
        try {
            if (reusePage) {
                page = sharedPage;
            } else {
                page = await context.newPage();
                // In new-tab mode, close the previous tab now that the new one is open
                if (newTab && prevPage) {
                    await prevPage.close().catch(() => { });
                    prevPage = null;
                }
            }

            const waitReady = process.argv.includes("--wait-ready");
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                referer: "https://www.teamblind.com/"
            });
            if (waitReady) {
                await page.waitForSelector('h2, [class*="title"], [class*="Title"]', { timeout: 15000 }).catch(() => { });
                await page.waitForTimeout(1000);
                logger.log("⏳ Page ready (content visible)");
            }

            // Snapshot after page load
            if (useSnapshot) {
                const SNAP_DIR = path.join(OUT_DIR, "screenshots");
                fs.mkdirSync(SNAP_DIR, { recursive: true });
                await page.screenshot({ path: path.join(SNAP_DIR, `${slug}_before.png`), fullPage: true });
                logger.log(`📸 Saved pre-scrape screenshot`);
            }

            const data = await extractPostData(page, url, logger, { captureTopLevel: true });

            // Snapshot after extraction
            if (useSnapshot) {
                const SNAP_DIR = path.join(OUT_DIR, "screenshots");
                await page.screenshot({ path: path.join(SNAP_DIR, `${slug}_after.png`), fullPage: true });
                logger.log(`📸 Saved post-scrape screenshot`);
            }

            const filePath = path.join(OUT_DIR, `${slug}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            logger.log(`✅ Saved: ${filePath}`);
            logger.log(`   Top-level comments: ${data.replies.length}`);
            logger.log(`   Scraped count: ${data.scrapedCommentsCount}`);
            logger.log(`   Metadata count: ${data.commentsCount}`);

            // Debug pause: keep browser open for 10 minutes to inspect
            if (debugMode) {
                logger.log(`🐛 DEBUG: Pausing 10 minutes — inspect the browser. (Ctrl+C to abort)`);
                await page.waitForTimeout(10 * 60 * 1000);
            }

            // Track page for new-tab mode
            if (newTab) prevPage = page;
        } catch (e) {
            if (useSnapshot && page) {
                const SNAP_DIR = path.join(OUT_DIR, "screenshots");
                fs.mkdirSync(SNAP_DIR, { recursive: true });
                await page.screenshot({ path: path.join(SNAP_DIR, `${slug}_error.png`), fullPage: true }).catch(() => { });
            }
            logger.error(`Error: ${e.message}`);
            // On error in new-tab mode, close the failed page
            if (newTab && page) { await page.close().catch(() => { }); prevPage = null; }
        } finally {
            // In default mode, close page after each URL
            if (!reusePage && !newTab && !newBrowser && page) await page.close().catch(() => { });
        }
    }

    console.log(`\n✅ Done. Processed ${URLS.length} URL(s).\n`);
    await browser.close().catch(() => { });
})();
