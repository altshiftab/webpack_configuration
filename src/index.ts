import {extname, basename, resolve as pathResolve} from "node:path";
import {globSync} from "node:fs";
import {createRequire} from "node:module";
import {cwd} from "node:process";

import type {Configuration} from 'webpack';
import TerserPlugin from 'terser-webpack-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import Webpack from 'webpack';
import RemoveEmptyScriptsPlugin from 'webpack-remove-empty-scripts';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';

// Patch to make `SubresourceIntegrityPlugin` work...
const require = createRequire(import.meta.url);
const {SubresourceIntegrityPlugin} = require('webpack-subresource-integrity');

// Patch to make current-directory resolution work.
const __dirname  = cwd();

export interface Parameters {
    entry: Record<string, string>;
    htmlPages: {
        template: string;
        filename: string;
        chunks: string[]
    }[];
    aliases: Record<string, string>;
}

export function generateParameters(): Parameters {
    const entry: Record<string, string> = {};
    const htmlPages: Parameters['htmlPages'] = [];

    for (const sourceFilePath of globSync("src/**")) {
        const extension = extname(sourceFilePath);
        switch (extension) {
            case ".html":
                const chunk = basename(sourceFilePath, extension)
                htmlPages.push({
                    template: sourceFilePath,
                    filename: `${chunk}${extension}`,
                    chunks: [chunk]
                });
                break;
            case ".ts":
                entry[basename(sourceFilePath, extension)] = `./${sourceFilePath}`;
                break;
        }
    }

    return {
        entry,
        htmlPages,
        aliases: {
            lit: 'lit',
            litDecorators: 'lit/decorators.js',
            altshiftBox: pathResolve(__dirname, 'node_modules/@altshiftab/web_components/dist/box.js'),
            altshiftSwitch: pathResolve(__dirname, 'node_modules/@altshiftab/web_components/dist/switch.js')
        }
    }
}

export function makeConfigWithParameters(parameters: Parameters): Configuration {
    return {
        mode: 'production',
        entry: parameters.entry,
        output: {
            filename: 'scripts/[name]-[contenthash].js',
            path: pathResolve(__dirname, 'dist'),
            assetModuleFilename: 'images/[name].[contenthash][ext]',
            clean: true,
            crossOriginLoading: "anonymous",
        },
        devtool: 'source-map',
        optimization: {
            minimize: true,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        compress: true,
                    },
                    extractComments: false,
                }),
                new CssMinimizerPlugin(),
            ],
            splitChunks: {
                chunks: 'all',
            },
        },
        resolve: {
            extensions: [".ts", ".js"],
            alias: parameters.aliases,
        },
        plugins: [
            new Webpack.ProvidePlugin({
                lit: 'lit',
                litDecorators: "lit/decorators.js",
                altshiftBox: "@altshiftab/web_components/box",
                altshiftSwitch: "@altshiftab/web_components/switch"
            }),
            new Webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1,
            }),
            new RemoveEmptyScriptsPlugin(),
            new MiniCssExtractPlugin({
                filename: 'styles/[name]-[contenthash].css',
            }),
            ...parameters.htmlPages.map(page => new HtmlWebpackPlugin(page)),
            new SubresourceIntegrityPlugin()
        ],
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [MiniCssExtractPlugin.loader, "css-loader"],
                },
                {
                    test: /\.(woff2?|eot|ttf|otf)$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: 'fonts/[name][ext]',
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif|avif)$/,
                    type: 'asset/resource',
                },
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "@altshiftab/minify_lit"
                        },
                        {
                            loader: 'babel-loader',
                            options: {
                                presets: [
                                    ["@babel/preset-env", {
                                        targets: ["last 2 versions", "not dead"]
                                    }],
                                    "@babel/preset-typescript"
                                ],
                                "plugins": [
                                    "@babel/plugin-transform-class-static-block",
                                    "@babel/plugin-transform-private-methods"
                                ]
                            }
                        },
                        {
                            loader: "ts-loader",
                        }
                    ]
                },
            ]
        }
    }
}

export function makeConfig(): Configuration{
    return makeConfigWithParameters(generateParameters());
}
