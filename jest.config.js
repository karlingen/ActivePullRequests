module.exports = {
    testEnvironment: "node",
    transform: {
        // tsconfig.json targets AMD for webpack; Jest needs CommonJS
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs", esModuleInterop: true } }]
    }
};
