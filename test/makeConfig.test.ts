import assert from "node:assert/strict";
import {test, describe} from "node:test";

import type {Configuration, RuleSetRule, WebpackPluginInstance} from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";

import {makeConfigWithParameters, type Parameters} from "../src/index.ts";

const parameters: Parameters = {
    entry: {index: "./src/scripts/index.ts"},
    htmlPages: [
        {template: "src/index.html", filename: "index.html", chunks: ["index"]},
        {template: "src/about/index.html", filename: "about/index.html", chunks: ["about_index"]},
    ],
};

function findRule(config: Configuration, predicate: (rule: RuleSetRule) => boolean): RuleSetRule {
    const rule = (config.module!.rules as RuleSetRule[]).find(
        rule => rule && typeof rule === "object" && predicate(rule)
    );
    assert.ok(rule, "expected a matching module rule");
    return rule;
}

// The font preload plugin is the only plugin that is a plain object rather than a class instance.
function findFontPreloadPlugin(config: Configuration): WebpackPluginInstance | undefined {
    return config.plugins!.find((plugin): plugin is WebpackPluginInstance =>
        plugin != null
        && typeof plugin === "object"
        && plugin.constructor === Object
        && typeof plugin.apply === "function"
    );
}

describe("makeConfigWithParameters", () => {
    test("produces a production config with the provided entries", () => {
        const config = makeConfigWithParameters(parameters);

        assert.equal(config.mode, "production");
        assert.deepEqual(config.entry, parameters.entry);
        assert.deepEqual(config.resolve?.extensions, [".ts", ".js"]);

        assert.equal(config.output?.publicPath, "/");
        assert.equal(config.output?.crossOriginLoading, "anonymous");
        assert.equal(config.output?.clean, true);
        assert.match(config.output?.filename as string, /^scripts\/.*\[contenthash]/);
    });

    test("creates one HtmlWebpackPlugin per page with the page options", () => {
        const config = makeConfigWithParameters(parameters);

        const htmlPlugins = config.plugins!.filter(
            plugin => plugin instanceof HtmlWebpackPlugin
        );

        assert.equal(htmlPlugins.length, parameters.htmlPages.length);
        assert.deepEqual(htmlPlugins.map(plugin => plugin.userOptions), parameters.htmlPages);
    });

    test("places extra plugins before the built-in plugins", () => {
        const extraPlugin = {apply() {}};

        const config = makeConfigWithParameters(parameters, extraPlugin);

        assert.equal(config.plugins![0], extraPlugin);
    });

    test("includes the font preload plugin only when preloadFonts is set", () => {
        const withoutFonts = makeConfigWithParameters(parameters);
        const withFonts = makeConfigWithParameters({...parameters, preloadFonts: /^fonts\//});

        assert.equal(findFontPreloadPlugin(withoutFonts), undefined);
        assert.ok(findFontPreloadPlugin(withFonts));
    });

    test("routes assets to per-type output directories", () => {
        const config = makeConfigWithParameters(parameters);

        for (const [fileName, outputDirectory] of [
            ["body.woff2", "fonts/"],
            ["logo.png", "images/"],
            ["report.pdf", "documents/"],
        ] as const) {
            const rule = findRule(config, rule =>
                rule.type === "asset/resource" && (rule.test as RegExp).test(fileName)
            );
            const generatorFilename = (rule.generator as {filename: string}).filename;
            assert.ok(
                generatorFilename.startsWith(outputDirectory),
                `${fileName} should be emitted under ${outputDirectory}, got ${generatorFilename}`
            );
        }
    });
});

describe("html-loader source filters", () => {
    type SourceFilter = (
        tag: string,
        attribute: string,
        attributes: {name?: string, value?: string}[],
        resourcePath: string,
    ) => boolean;

    function getSourceFilters(): {linkFilter: SourceFilter, anchorFilter: SourceFilter} {
        const config = makeConfigWithParameters(parameters);
        const htmlRule = findRule(config, rule => rule.loader === "html-loader");
        const list = (htmlRule.options as {sources: {list: ({tag?: string, filter?: SourceFilter} | string)[]}})
            .sources.list;

        const entryFor = (tag: string) => list.find(
            entry => typeof entry === "object" && entry.tag === tag
        ) as {filter: SourceFilter};

        return {linkFilter: entryFor("link").filter, anchorFilter: entryFor("a").filter};
    }

    test("link hrefs are only processed for icon-like rel values", () => {
        const {linkFilter} = getSourceFilters();
        const filterWithRel = (rel?: string) => linkFilter(
            "link",
            "href",
            rel === undefined ? [] : [{name: "rel", value: rel}],
            "src/index.html",
        );

        assert.equal(filterWithRel("icon"), true);
        assert.equal(filterWithRel("mask-icon"), true);
        assert.equal(filterWithRel("apple-touch-icon"), true);

        assert.equal(filterWithRel("stylesheet"), false);
        assert.equal(filterWithRel(""), false);
        assert.equal(filterWithRel(undefined), false);
    });

    test("anchor hrefs are only processed for pdf targets", () => {
        const {anchorFilter} = getSourceFilters();
        const filterWithHref = (href?: string) => anchorFilter(
            "a",
            "href",
            href === undefined ? [] : [{name: "href", value: href}],
            "src/index.html",
        );

        assert.equal(filterWithHref("documents/report.pdf"), true);
        assert.equal(filterWithHref("report.pdf?download=1"), true);
        assert.equal(filterWithHref("report.PDF"), true);

        assert.equal(filterWithHref("page.html"), false);
        assert.equal(filterWithHref("report.pdfx"), false);
        assert.equal(filterWithHref(undefined), false);
    });
});

describe("font preload plugin", () => {
    async function collectHeadTags(
        pattern: RegExp,
        assetNames: string[],
        publicPath: unknown = "/",
        existingHeadTags: unknown[] = [],
    ) {
        const config = makeConfigWithParameters({...parameters, preloadFonts: pattern});
        const plugin = findFontPreloadPlugin(config)!;

        const compilationTaps: ((compilation: unknown) => void)[] = [];
        plugin.apply({
            hooks: {
                compilation: {
                    tap: (_name: string, fn: (compilation: unknown) => void) => compilationTaps.push(fn),
                },
            },
        } as never);

        const compilation = {
            outputOptions: {publicPath},
            assets: Object.fromEntries(assetNames.map(name => [name, {}])),
        };
        for (const tapped of compilationTaps)
            tapped(compilation);

        const data = {
            headTags: [...existingHeadTags],
            bodyTags: [],
            outputName: "index.html",
            publicPath: "/",
            plugin: new HtmlWebpackPlugin(),
        };
        await HtmlWebpackPlugin.getHooks(compilation as never)
            .alterAssetTagGroups.promise(data as never);
        return data.headTags as {tagName: string, attributes: Record<string, string>}[];
    }

    test("adds a preload link for each matching font asset", async () => {
        const headTags = await collectHeadTags(
            /^fonts\//,
            ["fonts/body.woff2", "scripts/index.js", "styles/index.css"],
        );

        assert.equal(headTags.length, 1);
        assert.equal(headTags[0].tagName, "link");
        assert.deepEqual(headTags[0].attributes, {
            rel: "preload",
            as: "font",
            type: "font/woff2",
            href: "/fonts/body.woff2",
            crossorigin: "anonymous",
        });
    });

    test("maps each font extension to its mime type", async () => {
        const headTags = await collectHeadTags(
            /^fonts\//,
            ["fonts/a.woff2", "fonts/b.woff", "fonts/c.ttf", "fonts/d.otf"],
        );

        assert.deepEqual(
            headTags.map(tag => tag.attributes.type).toSorted(),
            ["font/otf", "font/ttf", "font/woff", "font/woff2"],
        );
    });

    test("prepends preload links before existing head tags", async () => {
        const existingTag = {tagName: "meta", voidTag: true, meta: {}, attributes: {}};

        const headTags = await collectHeadTags(/^fonts\//, ["fonts/body.woff2"], "/", [existingTag]);

        assert.equal(headTags.length, 2);
        assert.equal(headTags[0].tagName, "link");
        assert.equal(headTags[1], existingTag as never);
    });

    test("skips matching assets without a known font extension", async () => {
        const headTags = await collectHeadTags(/^fonts\//, ["fonts/license.txt", "fonts/logo.svg"]);

        assert.deepEqual(headTags, []);
    });

    test("prefixes hrefs with the configured public path", async () => {
        const headTags = await collectHeadTags(
            /^fonts\//,
            ["fonts/body.woff2"],
            "https://cdn.example.com/",
        );

        assert.equal(headTags[0].attributes.href, "https://cdn.example.com/fonts/body.woff2");
    });

    test("falls back to '/' when the public path is not a string", async () => {
        const headTags = await collectHeadTags(/^fonts\//, ["fonts/body.woff2"], undefined);

        assert.equal(headTags[0].attributes.href, "/fonts/body.woff2");
    });
});
