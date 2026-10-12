---
name: run-app
description: Run the Active Pull Requests extension inside the real Azure DevOps page with Playwright, to confirm a change works. Use when asked to run, check, or screenshot the app.
---

# Run the app in Azure DevOps

The extension only renders inside an Azure DevOps hub, because it waits for the host page to pass it the project, a token, and the git client. This skill opens the dev hub in headless Chromium with a saved login. The dev extension loads its bundle from the local dev server, so the page runs your working copy.

## Steps

1. Start the dev server in the background, and wait for "compiled successfully":

   ```sh
   npm start > <scratchpad>/devserver.log 2>&1
   ```

2. Open the hub. The script prints the frame URL, the visible text of the extension, and console errors. It also saves a screenshot. Look at the screenshot.

   ```sh
   node .claude/skills/run-app/drive.mjs <scratchpad>/hub.png
   ```

3. To interact with the page, write a small module and pass it as the second argument. `frame` is the extension iframe. All app UI lives there.

   ```js
   // <scratchpad>/actions.mjs
   export default async ({ page, frame }) => {
       await frame.getByRole("button", { name: "Filter" }).click();
       await frame.getByText("Repositories").click();
   };
   ```

   ```sh
   node .claude/skills/run-app/drive.mjs <scratchpad>/hub.png <scratchpad>/actions.mjs
   ```

4. Stop the dev server when you are done (`lsof -ti tcp:3000 | xargs kill`).

## Read the output

- If the script prints `WARNING: frame is not served from 127.0.0.1:3000`, the page is running a published build, not your code. Do not report the check as passed.
- Exit code 4 means no hub URL is saved. Ask the user for the URL of their dev hub (Repos -> Active Pull Requests), and write it to `.auth/hub-url.txt`. Keep it out of the repo, because the repo is public and the URL names a private org.
- Exit code 2 means no login is saved. Exit code 3 means the login expired. In both cases, ask the user to run this command. They sign in themselves in the window that opens, then close it:

  ```sh
  ! npx playwright codegen --save-storage=.auth/ado.json https://dev.azure.com
  ```

- `.auth/ado.json` holds a full Azure DevOps session. It is in `.gitignore`. Never print it, commit it, or send it anywhere.
- To use another hub for one run, set `HUB_URL`.
- The table is virtualized, so `rows rendered` counts only the visible rows. The total is the count in the title.
- Ignore the repeated `No permissions found for security namespace` errors and a single 404. They come from the Azure DevOps host page, not from the extension.

## Notes

- The driver starts Chromium with `--disable-features=LocalNetworkAccessChecks`. Without it, Chromium blocks `dev.azure.com` from framing `127.0.0.1` (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`), and the frame shows `chrome-error://`.
- Azure DevOps keeps the extension iframe hidden until the extension reports that it loaded. For that reason, the driver waits for the iframe to exist, not to be visible.
- The installed Playwright is pinned to `~1.57.0`, because newer versions need Node 20 and this project uses Node 18.
- Filter changes are saved to the user's real extension data. A check that changes filters also changes what the user sees next time.
