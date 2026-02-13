import { chromium } from "playwright";
import fs from "fs";

async function debugExtraction() {
    const url = "https://www.teamblind.com/post/att-and-t-mobile-cutting-1000s-of-jobs-3ba4to0r";
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle" });

    // Give it a moment to stabilize
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
        const scrapeTimeRaw = Date.now();

        const normalizeDateInternal = (dateStr) => {
            if (!dateStr) return "";
            return dateStr.trim();
        };

        const extractReplies = (rootElement, depth = 0) => {
            if (depth > 10) return [];
            const commentId = rootElement.id;

            // LOGGING for debug
            const debugInfo = {
                id: commentId,
                hasPlInSelf: !!rootElement.querySelector('div[class*="pl-"]'),
                nextSiblingClass: rootElement.nextElementSibling?.className || "null",
                parentNextSiblingClass: rootElement.parentElement?.nextElementSibling?.className || "null",
                parentNextSiblingHasPl: !!rootElement.parentElement?.nextElementSibling?.querySelector('div[class*="pl-"]')
            };

            let threadContainer = rootElement.querySelector('div[class*="pl-"]');
            if (!threadContainer && rootElement.nextElementSibling?.className?.includes('pl-')) threadContainer = rootElement.nextElementSibling;
            if (!threadContainer) {
                const parentSibling = rootElement.parentElement?.nextElementSibling;
                if (parentSibling) threadContainer = parentSibling.className?.includes('pl-') ? parentSibling : parentSibling.querySelector('div[class*="pl-"]');
            }

            if (!threadContainer) return [];

            const replyElements = Array.from(threadContainer.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
                let parent = el.parentElement;
                while (parent && parent !== threadContainer) {
                    if (parent.id && parent.id.startsWith('comment-') && !parent.id.startsWith('comment-group-')) return false;
                    parent = parent.parentElement;
                }
                return true;
            });

            return replyElements.map(el => {
                const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
                const rUserName = header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "";
                return {
                    userName: rUserName,
                    commentId: el.id,
                    nested: extractReplies(el, depth + 1)
                };
            });
        };

        const rootCommentElements = Array.from(document.querySelectorAll('div[id^="comment-"]:not([id^="comment-group-"])')).filter(el => {
            return !el.parentElement.closest('div[class*="pl-"]');
        });

        return rootCommentElements.map(el => {
            const header = el.querySelector('.flex.flex-wrap.text-xs.font-semibold.text-gray-700');
            const rUserName = header?.querySelector('span:not(.text-gray-600)')?.textContent?.trim() || "";
            return {
                userName: rUserName,
                commentId: el.id,
                nested: extractReplies(el)
            };
        });
    });

    console.log(JSON.stringify(result, null, 2));

    // Find scandeep and see if it has nested
    const scandeep = result.find(c => c.userName === "scandeep");
    if (scandeep) {
        console.log("\n--- SCANDEEP FOUND ---");
        console.log(`Nested count: ${scandeep.nested.length}`);
        if (scandeep.nested.length > 0) {
            console.log("Nested Users:", scandeep.nested.map(n => n.userName).join(", "));
        } else {
            console.log("BUG REPRODUCED: No nested comments found for scandeep.");
        }
    } else {
        console.log("scandeep not found in results.");
    }

    await browser.close();
}

debugExtraction().catch(console.error);
