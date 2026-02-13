import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

async function login(page) {
    console.log("Attempting auto-login...");
    await page.goto("https://www.teamblind.com/login");
    try {
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 15000 });
        console.log("Auto-login successful.");
    } catch (e) {
        console.log("Login failed or requires manual intervention.");
        await page.waitForTimeout(10000); // Wait for manual login
    }
}

async function extractWidgetOnly(page, url) {
    console.log(`Testing: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // Click View Result if present
    try {
        const viewResultBtn = await page.$('button:has-text("View Result")');
        if (viewResultBtn) {
            await viewResultBtn.click();
            await page.waitForTimeout(2000);
        }
    } catch (e) { }

    const data = await page.evaluate(({ scrapeTimeRaw }) => {
        const getSafeText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
        const title = getSafeText("h1");
        const channel = getSafeText('a[data-testid="article-preview-channel"]');

        let post_type = "regular_post";
        let pollContainer = null;

        const pollBadge = Array.from(document.querySelectorAll('span, div')).find(el =>
            (el.textContent === "Poll" && (el.classList.contains('text-red-600') || el.classList.contains('text-red-800'))) ||
            (el.textContent === "Offer" && (el.classList.contains('text-green') || el.classList.contains('text-green-800')))
        );

        if (pollBadge) {
            post_type = pollBadge.textContent.trim() === "Poll" ? "poll" : "offer";
            pollContainer = pollBadge.closest('div.rounded-lg.border') ||
                pollBadge.parentElement?.closest('div.rounded-lg.border') ||
                pollBadge.parentElement?.parentElement?.closest('div.rounded-lg.border');
        }

        if (!pollContainer) {
            const participantsText = Array.from(document.querySelectorAll('div, span')).find(el =>
                el.textContent?.includes('Participants') &&
                (el.querySelector('span.font-semibold') || el.classList.contains('font-semibold'))
            );
            if (participantsText) {
                pollContainer = participantsText.closest('div.rounded-lg.border');
                if (post_type === "regular_post") {
                    post_type = channel === "Offer Evaluation" ? "offer" : "poll";
                }
            }
        }

        let pollData = null;

        if (pollContainer) {
            const options = [];
            let participants = 0;
            const participantsMatch = pollContainer.textContent?.match(/([\d,]+)\s*Participants?/i);
            if (participantsMatch) {
                participants = parseInt(participantsMatch[1].replace(/,/g, ''), 10);
            }

            if (post_type === "poll") {
                let optionRows = Array.from(pollContainer.querySelectorAll('div.relative.mb-3, div.relative'));
                optionRows = optionRows.filter(row => row.textContent?.includes('%'));

                optionRows.forEach((row) => {
                    const label = row.querySelector('.flex-1.text-sm')?.textContent?.trim() ||
                        row.querySelector('label')?.textContent?.trim() ||
                        Array.from(row.childNodes).find(n => n.nodeType === 3)?.textContent?.trim() || "";

                    const resultText = row.querySelector('.text-xs.font-semibold')?.textContent?.trim() ||
                        row.querySelector('.font-semibold')?.textContent?.trim() || "";

                    const resultMatch = resultText.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);
                    if (label && resultMatch) {
                        options.push({
                            label,
                            percent: parseFloat(resultMatch[1]),
                            votes: parseInt(resultMatch[2], 10)
                        });
                    }
                });
            } else if (post_type === "offer") {
                const offerBlocks = pollContainer.querySelectorAll('div.flex.space-x-2.rounded-lg.border');
                offerBlocks.forEach((block) => {
                    const company = block.querySelector('label')?.textContent?.trim() || "Unknown";
                    const role = block.querySelector('.text-sm.font-semibold')?.textContent?.trim() || "";
                    const level = block.querySelector('.text-xs.text-gray-600')?.textContent?.trim() || "";

                    const extractField = (label) => {
                        const prefixNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim().startsWith(label) && el.children.length === 0
                        );
                        if (prefixNodes.length > 0) {
                            return prefixNodes[0].textContent.replace(label, '').trim();
                        }

                        const labelNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                            el.textContent?.trim() === label.replace(':', '').trim()
                        );
                        if (labelNodes.length > 0) {
                            const valueNode = labelNodes[0].previousElementSibling;
                            if (valueNode) return valueNode.textContent.trim();
                        }

                        return "";
                    };

                    const tcValue = extractField('TC:');
                    const baseValue = extractField('Base:');
                    const equityValue = extractField('Equity:');
                    const signOnValue = extractField('Sign-on:');
                    const bonusValue = extractField('Bonus:');

                    const resultText = block.querySelector('.text-xs.font-semibold')?.textContent?.trim() ||
                        block.querySelector('.font-semibold')?.textContent?.trim() || "";
                    const resultMatch = resultText.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);

                    options.push({
                        label: company,
                        role,
                        level,
                        tc: tcValue,
                        base: baseValue,
                        equity: equityValue,
                        signOn: signOnValue,
                        bonus: bonusValue,
                        percent: resultMatch ? parseFloat(resultMatch[1]) : 0,
                        votes: resultMatch ? parseInt(resultMatch[2], 10) : 0
                    });
                });
            }

            if (options.length > 0) {
                pollData = { post_type, participants, options };
                options.forEach((opt, i) => {
                    pollData[`option${i + 1}`] = opt.label;
                    pollData[`option${i + 1}_percent`] = opt.percent;
                    pollData[`option${i + 1}_votes`] = opt.votes;
                    if (opt.tc) pollData[`option${i + 1}_tc`] = opt.tc;
                    if (opt.base) pollData[`option${i + 1}_base`] = opt.base;
                    if (opt.equity) pollData[`option${i + 1}_equity`] = opt.equity;
                    if (opt.signOn) pollData[`option${i + 1}_signOn`] = opt.signOn;
                    if (opt.bonus) pollData[`option${i + 1}_bonus`] = opt.bonus;
                });
            }
        }
        return { post_type, poll: pollData };
    }, { scrapeTimeRaw: Date.now() });

    return data;
}

async function runTest() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);

    // Read URLs from file
    const urlsFile = path.join(__dirname, '../data/nvidia_offer_post_urls.txt');
    const allUrls = fs.readFileSync(urlsFile, 'utf-8').split('\n').filter(url => url.trim());
    const testUrls = allUrls.slice(0, 100); // First 100 URLs

    console.log(`Testing ${testUrls.length} URLs...`);

    // Create output directory
    const outputDir = path.join(__dirname, '../data/posts_test');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let stats = { total: 0, offers: 0, polls: 0, regular: 0, errors: 0 };

    for (let i = 0; i < testUrls.length; i++) {
        const url = testUrls[i];
        console.log(`[${i + 1}/${testUrls.length}] Processing: ${url}`);

        try {
            const data = await extractWidgetOnly(page, url);

            // Extract slug from URL (same logic as main scraper)
            const slug = url.split('/post/')[1] || `post-${i}`;
            const outputFile = path.join(outputDir, `${slug}.json`);

            // Save individual file
            fs.writeFileSync(outputFile, JSON.stringify({ url, ...data }, null, 2));
            console.log(`  ✓ Saved: ${slug}.json (${data.post_type})`);

            stats.total++;
            if (data.post_type === 'offer') stats.offers++;
            else if (data.post_type === 'poll') stats.polls++;
            else stats.regular++;

        } catch (error) {
            console.error(`  ✗ Error: ${error.message}`);
            stats.errors++;
        }

        await page.waitForTimeout(1000); // Small delay between requests
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total processed: ${stats.total}`);
    console.log(`Offers found: ${stats.offers}`);
    console.log(`Polls found: ${stats.polls}`);
    console.log(`Regular posts: ${stats.regular}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Output directory: ${outputDir}`);

    await browser.close();
}

runTest().catch(console.error);
