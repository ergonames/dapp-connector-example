const path = require('path');

var webpack = require('webpack');

module.exports = {
    entry: "./startup.js",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "startup.js",
    },
    experiments: {
        asyncWebAssembly: true,
        syncWebAssembly: true
    },
    mode: "development",
    plugins: [
        new webpack.ContextReplacementPlugin(
            /ergo-lib-wasm-browser/,
            (data) => {
                delete data.dependencies[0].critical;
                return data;
            },
        ),
    ],
};