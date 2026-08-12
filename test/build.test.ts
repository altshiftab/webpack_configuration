import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {test, before, after} from "node:test";
import {readFileSync, readdirSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

import webpack, {type Stats} from "webpack";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const distDirectory = join(fixtureDirectory, "dist");

// generateParameters and the output path resolve against the working directory.
const originalDirectory = process.cwd();
let stats: Stats;

before(async () => {
    process.chdir(fixtureDirectory);
    rmSync(distDirectory, {recursive: true, force: true});

    // The module resolves the working directory when it is first imported,
    // so it must not be imported until after the chdir above.
    const {generateParameters, makeConfigWithParameters} = await import("../src/index.ts");

    const parameters = generateParameters();
    parameters.entry.styles = "./src/styles/only.css";
    parameters.preloadFonts = /^fonts\//;

    stats = await new Promise((resolve, reject) => {
        webpack(makeConfigWithParameters(parameters), (error, stats) => {
            if (error)
                return reject(error);
            if (stats!.hasErrors())
                return reject(new Error(stats!.toString({errorDetails: true})));
            resolve(stats!);
        });
    });
});

after(() => {
    process.chdir(originalDirectory);
});

function distFiles(subDirectory: string): string[] {
    return readdirSync(join(distDirectory, subDirectory));
}

function readHtml(): string {
    return readFileSync(join(distDirectory, "index.html"), "utf-8");
}

test("emits hashed assets of every type", () => {
    assert.ok(distFiles("scripts").some(file => /^index-[0-9a-f]+\.js$/.test(file)));
    assert.ok(distFiles("styles").some(file => /^index-[0-9a-f]+\.css$/.test(file)));
    assert.ok(distFiles("images").some(file => /^logo\.[0-9a-f]+\.svg$/.test(file)));
    assert.ok(distFiles("fonts").some(file => /^body\.[0-9a-f]+\.woff2$/.test(file)));
});

test("removes the stub script of the style-only entry", () => {
    assert.ok(distFiles("styles").some(file => /^styles-[0-9a-f]+\.css$/.test(file)));
    assert.ok(!distFiles("scripts").some(file => file.startsWith("styles-")));
});

test("minifies the emitted javascript including tagged templates", () => {
    const scriptName = distFiles("scripts").find(file => file.startsWith("index-") && file.endsWith(".js"))!;
    const script = readFileSync(join(distDirectory, "scripts", scriptName), "utf-8");

    assert.ok(script.includes("fixture-entry"), "expected the entry code in the bundle");
    assert.ok(script.includes(".lit-element{color:red}"), "expected the css template to be minified");
    assert.ok(script.includes("<div> Fixture content </div>"), "expected the html template to be minified");
    assert.ok(!script.includes("\n    "), "expected minified output");
});

test("minifies the extracted css and rewrites the font url", () => {
    const styleName = distFiles("styles").find(file => file.startsWith("index-"))!;
    const style = readFileSync(join(distDirectory, "styles", styleName), "utf-8");

    assert.ok(style.includes(".app{"), "expected minified css");
    assert.ok(!style.includes("0px"), "expected units of zero values to be dropped");
    assert.match(style, /url\(\/fonts\/body\.[0-9a-f]+\.woff2\)/);
});

test("optimizes the svg while keeping its viewBox", () => {
    const imageName = distFiles("images").find(file => file.endsWith(".svg"))!;
    const image = readFileSync(join(distDirectory, "images", imageName), "utf-8");

    assert.ok(!image.includes("<!--"));
    assert.ok(!image.includes("<?xml"));
    assert.ok(image.includes('viewBox="0 0 10 10"'));
});

test("references the hashed image from the html", () => {
    const imageName = distFiles("images").find(file => file.endsWith(".svg"))!;
    assert.ok(readHtml().includes(`/images/${imageName}`));
});

test("adds valid subresource integrity to scripts and stylesheets", () => {
    const tags = [...readHtml().matchAll(/<(?:script|link)[^>]*>/g)]
        .map(match => match[0])
        .filter(tag => tag.includes('integrity="'));
    assert.ok(tags.length >= 2, "expected integrity on at least the entry script and stylesheet");

    for (const tag of tags) {
        const url = tag.match(/(?:src|href)="(\/(?:scripts|styles)\/[^"]+)"/)?.[1];
        assert.ok(url, `expected an asset url in ${tag}`);

        const integrity = tag.match(/integrity="([^"]+)"/)![1];
        const content = readFileSync(join(distDirectory, url.slice(1)));
        const expected = `sha384-${createHash("sha384").update(content).digest("base64")}`;
        assert.equal(integrity, expected, `integrity mismatch for ${url}`);
        assert.match(tag, /crossorigin="anonymous"/);
    }
});

test("preloads matching fonts at the start of head", () => {
    const html = readHtml();
    const fontName = distFiles("fonts").find(file => file.endsWith(".woff2"))!;

    const preloadMatch = html.match(/<link[^>]*rel="preload"[^>]*>/);
    assert.ok(preloadMatch, "expected a preload link");
    assert.ok(preloadMatch[0].includes(`/fonts/${fontName}`));
    assert.ok(preloadMatch[0].includes('as="font"'));
    assert.ok(preloadMatch[0].includes('type="font/woff2"'));
});
