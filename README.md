# Active Pull Requests
A VSTS extension for showing a list of all active pull requests for chosen projects with features such as sorting, filtering, and much more.

Each pull request row shows a `Build` column with the status of the build validation (branch policy) pipelines for that pull request: succeeded, failed, running or queued. Hover over the icon for a per-pipeline breakdown. The column is empty when no build validation policy applies to the pull request.

![alt text](images/screenshot.png)

After installing, open an Azure DevOps project and go to `Repos` -> `Active Pull Requests`.

![Where to find Active Pull Requests in Repos](images/repo.png)

# Dependencies

* Node v18 (run `nvm use` in project root if using [nvm](https://github.com/nvm-sh/nvm))

# Install
    npm install
    npm start

# Building the sample project
    npm run build # or build:dev

This produces a .vsix file which can be uploaded to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/azuredevops)

# Publishing
    npm run publish-extension-release # or publish-extension-dev

This automatically publishes to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/azuredevops)

# Contributing

This project welcomes contributions and suggestions. Please see [CONTRIBUTING.md](CONTRIBUTING.md).

# Problems?

## Blank page in development

Visit https://0.0.0.0:3000 in your browser and bypass the certficate issue and then reload the extension page.
