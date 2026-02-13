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
    await page.goto("https://www.teamblind.com/", { waitUntil: "networkidle" });

    const isLoggedIn = await page.evaluate(() => {
        return !!document.querySelector('a[href="/my-page"]') ||
            Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Log out'));
    }).catch(() => false);

    if (isLoggedIn) {
        console.log("Already logged in.");
        return;
    }

    const emailVisible = await page.$('input[name="email"]').then(el => el ? el.isVisible() : false).catch(() => false);

    if (!emailVisible) {
        const signInBtn = await page.$('button:has-text("Sign in"), a:has-text("Sign in"), button.bg-\\[\\#D83C3D\\]');
        if (signInBtn) {
            await signInBtn.click();
        } else {
            await page.goto("https://www.teamblind.com/sign-in", { waitUntil: "networkidle" });
        }
    }

    try {
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        await page.fill('input[name="email"]', CREDENTIALS.email);
        await page.fill('input[name="password"]', CREDENTIALS.password);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => {
            const url = window.location.href;
            return !url.includes('/login') && !url.includes('/sign-in') && !url.includes('/login-required');
        }, { timeout: 30000 });
        console.log("Auto-login successful.");
    } catch (e) {
        console.error("Login failed:", e.message);
        throw e;
    }
}

async function dismissBlockers(page) {
    return await page.evaluate(() => {
        let dismissed = false;

        // 1. Specific "Close" buttons for modals
        const closeSelectors = [
            'button.absolute.right-4.top-4',
            'button[aria-label="Close"]',
            '.icon-close',
            'div[class*="CloseButton"]'
        ];

        closeSelectors.forEach(s => {
            const btn = document.querySelector(s);
            if (btn && btn.offsetParent !== null) {
                btn.click();
                dismissed = true;
            }
        });

        // 2. Remove "Join the conversation" or "Sign up" modals directly
        const blockerTexts = ['Join the conversation', 'Sign up to read more', 'Sign up for free', 'Download the app'];
        const divs = Array.from(document.querySelectorAll('div, section'));
        divs.forEach(div => {
            if (div.style.position === 'fixed' || div.style.position === 'absolute') {
                if (blockerTexts.some(text => div.textContent.includes(text))) {
                    div.remove();
                    dismissed = "agg_removed";
                }
            }
        });

        // 3. Remove blur and overflow hidden
        if (document.body.style.overflow === 'hidden') document.body.style.overflow = 'auto';
        document.body.style.filter = 'none';

        const content = document.querySelector('main, #root');
        if (content) content.style.filter = 'none';

        return dismissed;
    });
}

async function debugPost() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);

    const url = "https://www.teamblind.com/post/5k-t-mobile-employees-sy87tdnq";
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle" });

    await dismissBlockers(page);

    // Specifically look for sharkbait
    const sharkbaitCommentId = "comment-33636716";
    console.log(`Locating sharkbait comment (${sharkbaitCommentId})...`);

    // Expand View more comments if needed
    let expandedMore = true;
    while (expandedMore) {
        const btn = await page.$('button:has-text("View more comments")');
        if (btn) {
            console.log("Clicking View more comments...");
            await btn.click({ force: true });
            await page.waitForTimeout(2000);
            await dismissBlockers(page);
        } else {
            expandedMore = false;
        }
    }

    // Now look for Sharkbait's reply expansion
    const sharkbaitEl = await page.$(`#${sharkbaitCommentId}`);
    if (sharkbaitEl) {
        console.log("Found sharkbait element.");

        // Search for "View X more replies" button
        // 1. Inside sharkbaitEl
        // 2. In sibling pl- container
        const subData = await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (!el) return { found: false };

            const findMoreBtn = (root) => Array.from(root.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));

            let btnInside = findMoreBtn(el);

            let threadContainer = el.querySelector('div[class*="pl-"]');
            if (!threadContainer && el.nextElementSibling?.className?.includes('pl-')) threadContainer = el.nextElementSibling;
            if (!threadContainer) {
                const parentSibling = el.parentElement?.nextElementSibling;
                if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
            }

            let btnInContainer = threadContainer ? findMoreBtn(threadContainer) : null;

            return {
                found: true,
                btnInside: btnInside ? btnInside.innerText : null,
                btnInContainer: btnInContainer ? btnInContainer.innerText : null,
                containerClass: threadContainer ? threadContainer.className : null,
                currentReplyCount: threadContainer ? threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])').length : 0
            };
        }, sharkbaitCommentId);

        console.log("Sharkbait Thread Info:", subData);

        if (subData.btnInContainer) {
            console.log(`Found expansion button in container: "${subData.btnInContainer}". CLICKING...`);
            // Attempt to click it
            await page.evaluate((id) => {
                const el = document.getElementById(id);
                const findMoreBtn = (root) => Array.from(root.querySelectorAll('button, a')).find(b => /more repl/i.test(b.innerText));

                let threadContainer = el.querySelector('div[class*="pl-"]');
                if (!threadContainer && el.nextElementSibling?.className?.includes('pl-')) threadContainer = el.nextElementSibling;
                if (!threadContainer) {
                    const parentSibling = el.parentElement?.nextElementSibling;
                    if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
                }

                let btn = threadContainer ? findMoreBtn(threadContainer) : null;
                if (btn) btn.click();
            }, sharkbaitCommentId);

            await page.waitForTimeout(3000);

            const finalCount = await page.evaluate((id) => {
                const el = document.getElementById(id);
                let threadContainer = el.querySelector('div[class*="pl-"]');
                if (!threadContainer && el.nextElementSibling?.className?.includes('pl-')) threadContainer = el.nextElementSibling;
                if (!threadContainer) {
                    const parentSibling = el.parentElement?.nextElementSibling;
                    if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
                }
                return threadContainer ? threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])').length : -1;
            }, sharkbaitCommentId);

            console.log(`Final reply count for sharkbait: ${finalCount}`);
        }
    } else {
        console.error("Sharkbait element not found!");
    }

    await browser.close();
}

debugPost().catch(console.error);
