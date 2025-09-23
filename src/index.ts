import {basename, resolve as pathResolve, relative, dirname, join} from "node:path";
import {globSync} from "node:fs";
import {createRequire} from "node:module";
import {cwd} from "node:process";

import type {Configuration, Compiler, WebpackPluginInstance} from "webpack";
import TerserPlugin from "terser-webpack-plugin";
import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import Webpack from "webpack";
import RemoveEmptyScriptsPlugin from "webpack-remove-empty-scripts";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';

// Patch to make `SubresourceIntegrityPlugin` work...
const require = createRequire(import.meta.url);
const {SubresourceIntegrityPlugin} = require("webpack-subresource-integrity");

type WebpackPlugin = (
    | undefined
    | null
    | false
    | ""
    | 0
    | ((this: Compiler, compiler: Compiler) => void)
    | WebpackPluginInstance
)

type HtmlElementAttributes = Partial<Record<string, string>>;

type HtmlLoaderSources =
    | boolean
    | {
    list?: {
        tag?: string;
        attribute?: string;
        type?: string;
        filter?: (
            tag: string,
            attribute: string,
            attributes: HtmlElementAttributes[],
            resourcePath: string,
        ) => boolean;
    }[];
    urlFilter?: (
        attribute: string,
        value: string,
        resourcePath: string,
    ) => boolean;
    scriptingEnabled?: boolean;
};

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

const scriptExtension = ".ts";
const documentExtension = ".html";

export function generateParameters(): Parameters {
    const entry: Record<string, string> = {};
    const htmlPages: Parameters["htmlPages"] = [];

    for (const scriptFilePath of globSync(`src/scripts/*${scriptExtension}`))
        entry[basename(scriptFilePath, scriptExtension)] = `./${scriptFilePath}`;

    for (const documentFilePath of globSync(`src/**/*${documentExtension}`)) {
        const relativePath = relative("src", documentFilePath);

        htmlPages.push({
            template: documentFilePath,
            filename: relativePath,
            chunks: [
                join(
                    dirname(relativePath),
                    basename(documentFilePath, documentExtension)
                ).replace(/\//g, "_")
            ]
        });
    }

    return {
        entry,
        htmlPages,
        aliases: {
            lit: "lit",
            litDecorators: "lit/decorators.js",
            altshiftBox: pathResolve(__dirname, "node_modules/@altshiftab/web_components/dist/box.js"),
            altshiftSwitch: pathResolve(__dirname, "node_modules/@altshiftab/web_components/dist/switch.js")
        }
    }
}

export function makeConfigWithParameters(parameters: Parameters, ...extraPlugins: WebpackPlugin[]): Configuration {
    return {
        mode: "production",
        entry: parameters.entry,
        output: {
            filename: "scripts/[name]-[contenthash].js",
            path: pathResolve(__dirname, "dist"),
            clean: true,
            crossOriginLoading: "anonymous",
        },
        devtool: "source-map",
        optimization: {
            minimize: true,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        compress: true,
                    },
                }),
                new CssMinimizerPlugin(),
                new ImageMinimizerPlugin<import('svgo').Config>({
                    test: /\.svg$/i,
                    //@ts-ignore
                    minimizer: {
                        implementation: ImageMinimizerPlugin.svgoMinify,
                        options: {
                            multipass: true,
                            plugins: [
                                {
                                    name: 'preset-default',
                                    params: {
                                        overrides: {
                                            removeViewBox: false,
                                        },
                                    },
                                },
                            ],
                        },
                    },
                }),
            ],
            splitChunks: {
                chunks: "all",
            },
        },
        resolve: {
            extensions: [".ts", ".js"],
            alias: parameters.aliases,
        },
        plugins: [
            ...extraPlugins,
            new Webpack.ProvidePlugin({
                lit: "lit",
                litDecorators: "lit/decorators.js",
                altshiftBox: "@altshiftab/web_components/box",
                altshiftSwitch: "@altshiftab/web_components/switch"
            }),
            new Webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1,
            }),
            new RemoveEmptyScriptsPlugin(),
            new MiniCssExtractPlugin({
                filename: "styles/[name]-[contenthash].css",
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
                    type: "asset/resource",
                    generator: {
                        filename: "fonts/[name].[contenthash][ext]",
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif|avif)$/,
                    type: "asset/resource",
                    generator: {
                        filename: "images/[name].[contenthash][ext]",
                    },
                },
                {
                    test: /\.html$/,
                    loader: "html-loader",
                    options: {
                        sources: {
                            list: [
                                "...",
                                {
                                    tag: "link",
                                    attribute: "href",
                                    type: "src",
                                    filter: (tag, attribute, attributes) => {
                                        const rel = attributes.find(a => a.name === "rel")?.value || "";
                                        return /^(icon|mask-icon|apple-touch-icon)$/.test(rel);
                                    },
                                },
                            ],
                        } as HtmlLoaderSources
                    },
                },
                {
                    test: /\.ts$/,
                    use: [
                        {
                            loader: "@altshiftab/minify_lit"
                        },
                    ]
                },
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "ts-loader",
                            options: {
                                compilerOptions: {
                                    module: "ESNext",
                                    moduleResolution: "Bundler",
                                    target: "ESNext",
                                    esModuleInterop: true,
                                    strict: true,
                                    outDir: "./dist",
                                    experimentalDecorators: true,
                                    useDefineForClassFields: false
                                },
                                onlyCompileBundledFiles: true,
                            }
                        }
                    ]
                },
            ]
        }
    }
}

export function makeConfig(...extraPlugins: WebpackPlugin[]): Configuration{
    return makeConfigWithParameters(generateParameters(), ...extraPlugins);
}
