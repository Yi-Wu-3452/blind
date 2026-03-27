import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-extra";
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

const limit = parseInt(args.find(arg => arg.startsWith("--limit="))?.split("=")[1] || "1000");
const reverse = args.includes("--reverse");
const force = args.includes("--force");

const noRecent = args.includes("--no-recent") || args.includes("--no_recent");
const useRobustScroll = args.includes("--robust-scroll") || args.includes("--robust_scroll");
const scrollInterval = parseInt(args.find(arg => arg.startsWith("--scroll-interval=") || arg.startsWith("--scroll_interval="))?.split("=")[1] || "2000");
const scrollLimit = parseInt(args.find(arg => arg.startsWith("--scroll-limit=") || arg.startsWith("--scroll_limit="))?.split("=")[1] || "20");
const startFrom = args.find(arg => arg.startsWith("--start-from="))?.split("=")[1];
const account = args.find(arg => arg.startsWith("--account="))?.split("=")[1];

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

    // Launch single browser instance
    console.log("🚀 Launching single browser instance for batch processing...");
    const browser = await chromium.launch({
        headless: false, // Per user preference for reliability
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

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    console.log(`🔑 Logging in with account "${account || 'default'}" before starting batch processing...`);
    await login(page, { manual: false, account });

    let processedCount = 0;
    let skipCount = 0;
    let foundStart = !startFrom;

    for (const company of companies) {
        if (limit > 0 && processedCount >= limit) {
            console.log(`\n🛑 Limit of ${limit} companies reached. Stopping.`);
            break;
        }

        const companyName = company["Company Name"];
        const symbol = company.Symbol;
        const postUrl = company["Post URL"];

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

        const runs = [];
        if (!noRecent) {
            runs.push({ sort: "recent", suffix: "_recent", stateKey: "recent" });
        }

        if (isLarge) {
            runs.push({ sort: null, suffix: "", stateKey: "all" });
        }

        let anyRunPerformed = false;
        for (const run of runs) {
            const outFile = path.join(companyDir, `${safeName}${run.suffix}.json`);

            const isAlreadyScraped = scrapeState[run.stateKey] === true;

            if ((isAlreadyScraped || fs.existsSync(outFile)) && !force) {
                console.log(`⏭️  [${processedCount + 1}/${companies.length}] Skipping ${companyName} (${run.sort || "default"} sort) - already scraped.`);
                continue;
            }

            console.log(`\n▶️  [${processedCount + 1}/${companies.length}] Processing: ${companyName} (${symbol}) - Sort: ${run.sort || "default"}`);
            // Set active log file for this specific run (e.g., recent vs all)
            const logFileName = `log${run.suffix}.txt`;
            setActiveLogFile(path.join(companyDir, logFileName));

            console.log(`   🔗 URL: ${postUrl}`);
            console.log(`   📂 Out: ${path.join("company_post_urls", safeName, path.basename(outFile))}`);

            try {
                let targetUrl = postUrl;
                if (run.sort) {
                    targetUrl += targetUrl.includes("?") ? `&sort=${run.sort}` : `?sort=${run.sort}`;
                }

                anyRunPerformed = true;
                await collectUrlsForCompany(page, {
                    targetUrl,
                    outFile,
                    scrollCount: 3,
                    useSimpleRetry: false,
                    useRobustScroll,
                    scrollInterval,
                    scrollLimit
                });

                scrapeState[run.stateKey] = true;
                fs.writeFileSync(stateFile, JSON.stringify(scrapeState, null, 2));

                console.log(`   ✅ Finished ${companyName} (${run.sort || "default"} sort)`);
            } catch (error) {
                console.error(`   ❌ Failed to process ${companyName} (${run.sort || "default"} sort): ${error.message}`);
                throw error;
            }

            // Cooldown between runs
            const cooldown = 3000 + Math.random() * 3000;
            console.log(`   ⏳ Cooldown for ${Math.round(cooldown / 1000)}s...`);
            await new Promise(r => setTimeout(r, cooldown));
        }

        if (anyRunPerformed) processedCount++;
    }

    console.log(`\n🏁 Batch process finished. Total processed: ${processedCount}.`);
    if (skipCount > 0) {
        console.log(`⏭️  Skipped ${skipCount} companies before reaching "${startFrom}".`);
    }
    await context.close();
    await browser.close();
}

runBatch().catch(async (err) => {
    console.error(`\n❌ Fatal error in batch process:`, err);
    process.exit(1);
});
