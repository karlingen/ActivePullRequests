# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Active Pull Requests is an Azure DevOps extension. It adds a hub under `Repos` -> `Active Pull Requests` that lists all active pull requests in the current project. The user can filter, sort, and open each pull request. The UI uses React 16 with class components and the `azure-devops-ui` component library.

## Commands

Use Node 18 (`nvm use` reads `.nvmrc`).

```sh
npm install
npm start                          # webpack-dev-server on https://0.0.0.0:3000
npm run build                      # production bundle + .vsix package (bumps manifest version)
npm run build:dev                  # development bundle + .vsix package
npm run publish-extension-dev      # publish private dev extension (configs/dev.json)
npm run publish-extension-release  # publish public extension (configs/release.json)
```

The project has no test suite and no linter. To check types, run `npx tsc --noEmit`.

The `postbuild` step runs `tfx extension create --rev-version`, which increments the `version` in `azure-devops-extension.json`. Do not edit that version by hand.

## Local development

The dev extension (`configs/dev.json`) sets `baseUri` to `https://127.0.0.1:3000`. Azure DevOps then loads the bundle from your local dev server instead of the packaged `dist`. If the page is blank, open `https://0.0.0.0:3000` in the browser, accept the self-signed certificate, and reload the extension page.

## Architecture

- `webpack.config.js` creates one entry for each folder in `src/Samples/`. The entry file must have the same name as its folder (`src/Samples/X/X.tsx` builds to `dist/X/X.js`). All `.html` files in `src/Samples` are copied to `dist`.
- `azure-devops-extension.json` is the root manifest (scopes `vso.code` and `vso.graph`). The packaging step merges it with every `src/Samples/**/*.json` file. `activepullrequests.json` contributes the `ms.vss-web.hub` that points to `dist/ActivePullRequests/context.html`.
- `src/Common.tsx` provides `showRootComponent`, which mounts the root component into `#root`.

The app has two components that share one `Filter` object from `azure-devops-ui`:

- `ActivePullRequests.tsx` is the page shell. It loads the repositories and builds the `FilterBar` with four dropdowns: Repositories, Created By, Reviewers, and Other (Published/Draft). It also restores persisted filter selections.
- `PullRequestsListingPageContent.tsx` fetches the active pull requests with `getPullRequestsByProject` (`top = 0` means no 100-item limit). It subscribes to the shared filter, filters and sorts the table, and loads comment threads and avatars for visible rows only. It sends the creator and reviewer lists up to the shell through the `updateUsers` callback.

Filter persistence uses the extension data service with `scopeType: "User"`. The keys are in `Constants.tsx`. `onFilterChanged` in the listing component saves each filter state. The shell restores the states on load. Persisted values contain full `GitRepository` or identity objects. Restore code must map them by `id` to the current objects, because the dropdown clears a selection that does not match by reference. If no saved value exists, the Other filter defaults to Published.

Startup order matters. The listing fetches pull requests, calls `updateUsers` (which fills the user dropdowns and applies their saved selections), then calls `filterByPersistedRepositories`, then calls `onFilterChanged` explicitly. The explicit call covers a fresh install, where no saved state exists and no filter change event fires.

## Code style

Match the style of the existing files: 4-space indentation and double quotes. Do not reformat a whole file as part of a functional change.
