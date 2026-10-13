# Active Pull Requests
A VSTS extension for showing a list of all active pull requests for chosen projects with features such as sorting, filtering, and much more.

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

Create a trusted local certificate once with [mkcert](https://github.com/FiloSottile/mkcert). The dev server uses it when `.certs/localhost.pem` exists:

```sh
brew install mkcert && mkcert -install
mkdir -p .certs && mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem 127.0.0.1 localhost 0.0.0.0
```

Without this certificate, visit https://127.0.0.1:3000 in your browser, accept the certificate, and then reload the extension page.
