import { chromium } from "playwright";

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    page.on("response", async (resp) => {
        const ct = resp.headers()["content-type"] || "";
        if (ct.includes("text/x-component")) {
            const url = resp.url();
            const text = await resp.text();
            console.log("\n=== RSC ===", url);
            console.log(text.slice(0, 2000));
        }
    });

    await page.goto("https://www.teamblind.com/search/Apple", {
        waitUntil: "domcontentloaded"
    });

    // uncomment to trigger infinite scroll
    // await page.mouse.wheel(0, 8000);

    // await browser.close();
})();
