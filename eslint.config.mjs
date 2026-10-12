import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/", "coverage/", "node_modules/"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // ponytail: existing code has ~30 `any` uses; make this an error once they are typed
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
            // React.Component<{}> and IListBoxItem<{}> are the azure-devops-ui idiom
            "@typescript-eslint/no-empty-object-type": "off"
        }
    },
    {
        files: ["**/*.{js,mjs}"],
        languageOptions: { globals: { require: "readonly", module: "writable", __dirname: "readonly", process: "readonly", console: "readonly", document: "readonly", URL: "readonly" } },
        rules: { "@typescript-eslint/no-require-imports": "off" }
    }
);
