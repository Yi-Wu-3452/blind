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
    console.log(`Testing post type/widget for: ${url}`);
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
        let debug = "";

        if (pollContainer) {
            const options = [];
            let participants = 0;
            const participantsMatch = pollContainer.textContent?.match(/([\d,]+)\s*Participants?/i);
            if (participantsMatch) {
                participants = parseInt(participantsMatch[1].replace(/,/g, ''), 10);
            }

            if (post_type === "poll") {
                // Try multiple patterns for poll rows
                let optionRows = Array.from(pollContainer.querySelectorAll('div.relative.mb-3, div.relative'));

                // Filter rows that actually look like poll options (text + percentage)
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

                if (options.length === 0) {
                    debug = "Found poll container but 0 options. HTML sample: " + pollContainer.innerHTML.substring(0, 500);
                }
            } else if (post_type === "offer") {
                const offerBlocks = pollContainer.querySelectorAll('div.flex.space-x-2.rounded-lg.border');
                offerBlocks.forEach((block) => {
                    const company = block.querySelector('label')?.textContent?.trim() || "Unknown";
                    const role = block.querySelector('.text-sm.font-semibold')?.textContent?.trim() || "";
                    const level = block.querySelector('.text-xs.text-gray-600')?.textContent?.trim() || "";

                    // TC extraction: find the element that JUST contains TC
                    const tcNodes = Array.from(block.querySelectorAll('div, span')).filter(el =>
                        el.textContent?.trim().startsWith('TC:') && el.children.length === 0
                    );
                    const tcValue = tcNodes.length > 0 ? tcNodes[0].textContent.replace('TC:', '').trim() : "";

                    const resultText = block.querySelector('.text-xs.font-semibold')?.textContent?.trim() ||
                        block.querySelector('.font-semibold')?.textContent?.trim() || "";
                    const resultMatch = resultText.match(/(\d+(?:\.\d+)?)\s*%\s*\((\d+)\)/);

                    options.push({
                        label: company,
                        role,
                        level,
                        tc: tcValue,
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
                });
            }
        }
        return { post_type, poll: pollData, debug };
    }, { scrapeTimeRaw: Date.now() });

    return data;
}

async function runTest() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);

    const testUrls = [
        "https://www.teamblind.com/post/is-nvidia-really-fcked-like-everyone-says-uakgdxh7",
        "https://www.teamblind.com/post/nvidia-vs-startup-wh0rtba4",
        "https://www.teamblind.com/post/nvidia-offer-vs-google-team-match-shall-i-wait-413onfna",
        "https://www.teamblind.com/post/meta-vs-nvidia-ihmsb7tg",
        "https://www.teamblind.com/post/amzn-stock-is-soaring-is-nvidia-fcked-hxopjccc"
    ];

    const results = [];
    for (const url of testUrls) {
        const data = await extractWidgetOnly(page, url);
        results.push({ url, ...data });
        await page.waitForTimeout(2000);
    }

    console.log(JSON.stringify(results, null, 2));
    await browser.close();
}

runTest().catch(console.error);
