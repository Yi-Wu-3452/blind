import { chromium } from "playwright";

const CREDENTIALS = {
    email: "fortestblind2026@gmail.com",
    password: "fortest00001!"
};

async function test() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Login
    await page.goto("https://www.teamblind.com/login");
    await page.fill('input[name="email"]', CREDENTIALS.email);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    // Go to test URL
    await page.goto("https://www.teamblind.com/post/nvidia-vs-startup-wh0rtba4");
    await page.waitForTimeout(2000);

    // Click View Result
    const viewBtn = await page.$('button:has-text("View Result")');
    if (viewBtn) {
        await viewBtn.click();
        await page.waitForTimeout(3000);
    }

    // Extract
    const result = await page.evaluate(() => {
        const pollContainer = document.querySelector('div.rounded-lg.border');
        const offerBlocks = pollContainer.querySelectorAll('div.flex.space-x-2.rounded-lg.border');
        const firstBlock = offerBlocks[0];

        const extractField = (label) => {
            const prefixNodes = Array.from(firstBlock.querySelectorAll('div, span')).filter(el =>
                el.textContent?.trim().startsWith(label) && el.children.length === 0
            );
            if (prefixNodes.length > 0) {
                return prefixNodes[0].textContent.replace(label, '').trim();
            }

            const labelNodes = Array.from(firstBlock.querySelectorAll('div, span')).filter(el =>
                el.textContent?.trim() === label.replace(':', '').trim()
            );
            if (labelNodes.length > 0) {
                const valueNode = labelNodes[0].previousElementSibling;
                if (valueNode) return valueNode.textContent.trim();
            }

            return "";
        };

        return {
            tc: extractField('TC:'),
            base_with_colon: extractField('Base:'),
            base_without_colon: extractField('Base'),
            equity_with_colon: extractField('Equity:'),
            equity_without_colon: extractField('Equity')
        };
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
}

test().catch(console.error);
