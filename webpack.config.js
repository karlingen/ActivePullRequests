const path = require("path");
const fs = require("fs");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// Trusted local certificate from mkcert (see CLAUDE.md). Without it, the dev server uses a
// self-signed certificate that the browser must accept by hand.
const certFile = path.join(__dirname, ".certs/localhost.pem"),
      keyFile = path.join(__dirname, ".certs/localhost-key.pem"),
      httpsOptions = fs.existsSync(certFile) ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) } : true;

// Webpack entry points. Mapping from resulting bundle name to the source file entry.
const entries = {};

// Loop through subfolders in the "Samples" folder and add an entry for each one
const samplesDir = path.join(__dirname, "src/Samples");
fs.readdirSync(samplesDir).filter(dir => {
    if (fs.statSync(path.join(samplesDir, dir)).isDirectory()) {
        entries[dir] = "./" + path.relative(process.cwd(), path.join(samplesDir, dir, dir));
    }
});

module.exports = {
    entry: entries,
    output: {
        publicPath: "/dist/",
        filename: "[name]/[name].js"
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js"],
        alias: {
            "azure-devops-extension-sdk": path.resolve("node_modules/azure-devops-extension-sdk")
        },
    },
    stats: {
        warnings: false
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "ts-loader"
            },
            {
                test: /\.scss$/,
                use: ["style-loader", "css-loader", "sass-loader", "azure-devops-ui/buildScripts/css-variables-loader"]
            },
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
            {
                test: /\.woff$/,
                use: [{
                    loader: 'base64-inline-loader'
                }]
            },
            {
                test: /\.html$/,
                loader: "file-loader"
            }
        ]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: "**/*.html", context: "src/Samples" }
            ]
        })
    ],

    devtool: "inline-source-map",
    devServer: {
        https: httpsOptions,
        port: 3000,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization"
        }
    }
};
