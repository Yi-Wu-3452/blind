import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { collectUrlsForCompany, login } from "./collect_company_urls_robust.mjs";
import { setActiveLogFile } from "./logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");
const DATA_DIR = path.resolve(ROOT_DIR, "data");
const BASE_OUT_DIR = path.resolve(DATA_DIR, "company_post_urls");
// Parse CLI args
const args = process.argv.slice(2);

const companyListArg = args.find(arg => arg.startsWith("--company-list=") || arg.startsWith("--company_list="))?.split("=")[1];
const COMPANY_LIST_PATH = companyListArg ? path.resolve(ROOT_DIR, companyListArg) : path.resolve(ROOT_DIR, "company_list.json");

const useStealth = args.includes("--use-stealth");
if (useStealth) {
    chromium.use(stealth());
}

const limit = parseInt(args.find(arg => arg.startsWith("--limit="))?.split("=")[1] || "1000");
const reverse = args.includes("--reverse");
const force = args.includes("--force");

const sortArg = args.find(arg => arg.startsWith("--sort="))?.split("=")[1];

const noRecent = args.includes("--no-recent") || args.includes("--no_recent");
const useRobustScroll = args.includes("--robust-scroll") || args.includes("--robust_scroll");
const scrollInterval = parseInt(args.find(arg => arg.startsWith("--scroll-interval=") || arg.startsWith("--scroll_interval="))?.split("=")[1] || "2000");
const scrollLimit = parseInt(args.find(arg => arg.startsWith("--scroll-limit=") || arg.startsWith("--scroll_limit="))?.split("=")[1] || "20");
const startFrom = args.find(arg => arg.startsWith("--start-from="))?.split("=")[1];
const account = args.find(arg => arg.startsWith("--account="))?.split("=")[1];
const isolate = args.includes("--isolate");
const rotateAccounts = args.includes("--rotate-accounts");

const proxyArgIndex = process.argv.indexOf('--proxy');
let proxyConfig = undefined;
if (proxyArgIndex !== -1 && process.argv[proxyArgIndex + 1]) {
    try {
        const rawProxy = process.argv[proxyArgIndex + 1];
        if (rawProxy.startsWith('socks5://')) {
            proxyConfig = { server: rawProxy };
            console.log(`🌐 Using Proxy: ${proxyConfig.server}`);
        } else {
            const pUrl = new URL(rawProxy.startsWith('http') ? rawProxy : `http://${rawProxy}`);
            proxyConfig = { server: `${pUrl.protocol}//${pUrl.host}` };
            if (pUrl.username) proxyConfig.username = decodeURIComponent(pUrl.username);
            if (pUrl.password) proxyConfig.password = decodeURIComponent(pUrl.password);
            console.log(`🌐 Using Proxy: ${proxyConfig.server}`);
        }
    } catch (e) {
        proxyConfig = { server: process.argv[proxyArgIndex + 1] };
        console.log(`🌐 Using Proxy (fallback): ${proxyConfig.server}`);
    }
}

async function runBatch() {
    if (!fs.existsSync(COMPANY_LIST_PATH)) {
        console.error(`❌ Error: company_list.json not found at ${COMPANY_LIST_PATH}`);
        return;
    }

    const companies = JSON.parse(fs.readFileSync(COMPANY_LIST_PATH, "utf-8"));
    if (reverse) {
        console.log("🔄 Reverse mode enabled. Reversing company list...");
        companies.reverse();
    }
    console.log(`📋 Loaded ${companies.length} companies from list.`);

    let currentAccount = account || "1";
    let browser = null;
    let context = null;
    let page = null;

    const launchBrowser = async () => {
        if (browser) {
            console.log("🧹 Closing previous browser instance...");
            await browser.close().catch(() => { });
        }
        console.log(`🚀 Launching browser instance (Account: ${currentAccount})...`);
        browser = await chromium.launch({
            headless: false,
            proxy: proxyConfig,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--window-size=1280,800',
            ]
        });
        context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });
        page = await context.newPage();

        if (!isolate) {
            console.log(`🔑 Logging in with account "${currentAccount}"...`);
            await login(page, { manual: false, account: currentAccount });
        }
    };

    await launchBrowser();

    let processedCount = 0;
    let skipCount = 0;
    let foundStart = !startFrom;

    const credentials = fs.existsSync(path.resolve(ROOT_DIR, "credentials.json"))
        ? JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, "credentials.json"), "utf-8"))
        : {};
    const accountKeys = Object.keys(credentials).sort();

    for (let cIdx = 0; cIdx < companies.length; cIdx++) {
        const company = companies[cIdx];
        if (limit > 0 && processedCount >= limit) {
            console.log(`\n🛑 Limit of ${limit} companies reached. Stopping.`);
            break;
        }

        const companyName = company["Company Name"];
        const symbol = company.Symbol;
        const postUrl = company["Post URL"];

        if (rotateAccounts && accountKeys.length > 0) {
            currentAccount = accountKeys[cIdx % accountKeys.length];
        }

        if (!postUrl) {
            console.warn(`⚠️ Skipping ${companyName}: No Blind URL found.`);
            continue;
        }

        if (!foundStart) {
            if (companyName.toLowerCase() === startFrom.toLowerCase() || symbol.toLowerCase() === startFrom.toLowerCase()) {
                foundStart = true;
            } else {
                skipCount++;
                continue;
            }
        }

        const safeName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
        const companyDir = path.join(BASE_OUT_DIR, safeName);
        if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });

        const stateFile = path.join(companyDir, "state.json");
        let scrapeState = { recent: false, all: false };
        if (fs.existsSync(stateFile)) {
            try {
                scrapeState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
            } catch (e) {
                console.error(`Error reading State json in ${stateFile}`);
            }
        }

        const postCount = parseInt(company["# Posts"] || "0");
        const isLarge = postCount > 10000;

        let runs = [];
        if (sortArg === "top") {
            runs.push({ sort: null, suffix: "_top", stateKey: "top" });
        } else if (sortArg === "recent") {
            runs.push({ sort: "recent", suffix: "_recent", stateKey: "recent" });
        } else if (sortArg === "all") {
            runs.push({ sort: "recent", suffix: "_recent", stateKey: "recent" });
            runs.push({ sort: null, suffix: "", stateKey: "all" });
        } else {
            if (!noRecent) runs.push({ sort: "recent", suffix: "_recent", stateKey: "recent" });
            if (isLarge) runs.push({ sort: null, suffix: "", stateKey: "all" });
        }

        let anyRunPerformed = false;
        for (const run of runs) {
            const outFile = path.join(companyDir, `${safeName}${run.suffix}.json`);
            const isAlreadyScraped = scrapeState[run.stateKey] === true;

            if ((isAlreadyScraped || fs.existsSync(outFile)) && !force) {
                console.log(`⏭️  [${processedCount + 1}/${companies.length}] Skipping ${companyName} (${run.sort || "default"} sort) - already scraped.`);
                continue;
            }

            let attempt = 0;
            const maxAttempts = accountKeys.length;
            let runSuccess = false;

            while (attempt < maxAttempts && !runSuccess) {
                console.log(`\n▶️  [${processedCount + 1}/${companies.length}] Processing: ${companyName} (${symbol}) - Sort: ${run.sort || "default"} (Attempt ${attempt + 1})`);
                const logFileName = `log${run.suffix}.txt`;
                setActiveLogFile(path.join(companyDir, logFileName));

                try {
                    let targetUrl = postUrl;
                    if (run.sort) {
                        targetUrl += targetUrl.includes("?") ? `&sort=${run.sort}` : `?sort=${run.sort}`;
                    }

                    anyRunPerformed = true;

                    if (isolate || attempt > 0) {
                        console.log(`🛡️  Isolation/Rotation: Refreshing browser for ${companyName}...`);
                        await launchBrowser();
                        if (isolate) {
                            console.log(`   🔑 Logging in for ${companyName} with account ${currentAccount}...`);
                            await login(page, { manual: false, account: currentAccount });
                        }
                    }

                    const result = await collectUrlsForCompany(page, {
                        targetUrl,
                        outFile,
                        scrollCount: 3,
                        useSimpleRetry: false,
                        useRobustScroll,
                        scrollInterval,
                        scrollLimit
                    });

                    if (result && result.status === 'BLOCKED') {
                        console.log(`   🚨 BLOCKED detected: ${result.reason}.`);
                        attempt++;
                        if (attempt < maxAttempts) {
                            const nextAccIndex = (accountKeys.indexOf(currentAccount) + 1) % accountKeys.length;
                            currentAccount = accountKeys[nextAccIndex];
                            console.log(`   🔄 Rotating to next account: ${currentAccount}`);
                            // Wait a bit before retry
                            await sleep(10000);
                            continue;
                        } else {
                            console.error(`   ❌ All accounts blocked for ${companyName}. Skipping.`);
                            break;
                        }
                    }

                    runSuccess = true;
                    scrapeState[run.stateKey] = true;
                    fs.writeFileSync(stateFile, JSON.stringify(scrapeState, null, 2));
                    console.log(`   ✅ Finished ${companyName} (${run.sort || "default"} sort)`);
                } catch (error) {
                    console.error(`   ❌ Error processing ${companyName}: ${error.message}`);
                    attempt++;
                    if (attempt < maxAttempts) {
                        await launchBrowser();
                        continue;
                    }
                    throw error;
                }
            }

            const cooldown = 5000 + Math.random() * 5000;
            console.log(`   ⏳ Cooldown for ${Math.round(cooldown / 1000)}s...`);
            await sleep(cooldown);
        }

        if (anyRunPerformed) processedCount++;

        if (isolate && processedCount < companies.length) {
            const companyDelay = 15000 + Math.random() * 15000;
            console.log(`\n🛡️  Isolation Delay: Waiting ${Math.round(companyDelay / 1000)}s next company...`);
            await sleep(companyDelay);
        }
    }

    console.log(`\n🏁 Batch process finished. Total processed: ${processedCount}.`);
    if (browser) await browser.close();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runBatch().catch(async (err) => {
    console.error(`\n❌ Fatal error in batch process:`, err);
    process.exit(1);
});
