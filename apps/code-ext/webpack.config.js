/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
    target: 'node', // extensions run in a node context
    entry: {
        extension: './src/extension.ts' // the entry point of this extension
    },
    output: {
        // the bundle is stored in the 'dist' folder (check package.json), ├── dist
        // └── extension.js
        path: path.join(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    },
    devtool: 'nosources-source-map',
    externals: {
        vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, ⚠️ and check extensions.json ⚠️
        '@anthropic-ai/claude-agent-sdk': 'commonjs @anthropic-ai/claude-agent-sdk', // SDK spawns subprocesses, must be external
        bufferutil: 'commonjs bufferutil', // Optional ws dependency
        'utf-8-validate': 'commonjs utf-8-validate' // Optional ws dependency
    },
    ignoreWarnings: [
        {
            // Ignore warnings about optional ws dependencies
            module: /node_modules\/ws\/lib\/(buffer-util|validation)\.js/,
            message: /Can't resolve '(bufferutil|utf-8-validate)'/
        }
    ],
    resolve: {
        // support reading TypeScript and JavaScript files, ⚠️ allow output ⚠️
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader'
                    }
                ]
            }
        ]
    },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(/node:/, (resource) => {
            resource.request = resource.request.replace(/^node:/, "");
        }),
        new CopyPlugin({
            patterns: [
                { from: 'commands', to: 'commands' },
                { from: 'media', to: 'media' },
                { from: 'examples/claude-session-wrapper.sh', to: 'examples/claude-session-wrapper.sh' }
            ]
        })
    ]
};
