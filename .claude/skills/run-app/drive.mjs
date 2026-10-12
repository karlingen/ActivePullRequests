// Opens the extension hub in Azure DevOps with a saved login, prints the title and
// rendered row count of the extension, and saves a screenshot.
//
// Usage: node .claude/skills/run-app/drive.mjs [screenshot.png] [actions.mjs]
// actions.mjs (optional) default-exports async ({ page, frame }) => { ... }
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { chromium } from "playwright";

// Both files live in the git-ignored .auth/ folder, so the org name stays out of this public repo
const AUTH_FILE = ".auth/ado.json",
      HUB_URL_FILE = ".auth/hub-url.txt",
      DEV_SERVER = "127.0.0.1:3000",
      TIMEOUT_MS = 60000;

const [ shotPath = "hub.png", actionsPath ] = process.argv.slice(2);

if (!process.env.HUB_URL && !existsSync(HUB_URL_FILE)) {
    console.error(`No hub URL. Ask the user for the dev hub URL and save it to ${HUB_URL_FILE}, or set HUB_URL.`);
    process.exit(4);
}

const HUB_URL = process.env.HUB_URL || readFileSync(HUB_URL_FILE, "utf8").trim(),
      LOGIN_HELP = `Ask the user to run:\n  npx playwright codegen --save-storage=${AUTH_FILE} ${new URL(HUB_URL).origin}`;

if (!existsSync(AUTH_FILE)) {
    console.error(`No login saved. ${LOGIN_HELP}`);
    process.exit(2);
}

// Chromium blocks a public site (dev.azure.com) from framing 127.0.0.1 unless the user allows it
const browser = await chromium.launch({ args: [ "--disable-features=LocalNetworkAccessChecks" ] }),
      context = await browser.newContext({ storageState: AUTH_FILE, ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } }),
      page = await context.newPage();

page.on("console", (msg) => {
    if (msg.type() === "error") {
        console.log(`[console.error] ${msg.text()}`);
    }
});

try {
    await page.goto(HUB_URL, { timeout: TIMEOUT_MS });

    if (page.url().includes("login.microsoftonline.com") || page.url().includes("/_signin")) {
        console.error(`Login expired. ${LOGIN_HELP}`);
        process.exit(3);
    }

    const frameHandle = await page.waitForSelector("iframe[src*='context.html']", { state: "attached", timeout: TIMEOUT_MS }),
          frame = await frameHandle.contentFrame();

    console.log(`frame: ${frame.url()}`);
    if (!frame.url().includes(DEV_SERVER)) {
        console.log(`WARNING: frame is not served from ${DEV_SERVER}; this page is NOT running local code`);
    }

    // The table replaces the loading spinner once pull requests are loaded and filtered
    await frame.waitForSelector(".bolt-table", { timeout: TIMEOUT_MS });

    if (actionsPath) {
        const actions = await import(pathToFileURL(resolve(actionsPath)).href);

        await actions.default({ page, frame });
    }

    console.log(`title: ${(await frame.innerText(".bolt-header-title")).trim()}`);
    console.log(`rows rendered: ${await frame.locator(".bolt-table-row[data-row-index]").count()}`);
    await page.screenshot({ path: shotPath });
    console.log(`screenshot: ${resolve(shotPath)}`);
} finally {
    await browser.close();
}
