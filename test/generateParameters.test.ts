import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {chdir, cwd} from "node:process";

import {generateParameters} from "../src/index.ts";

function inFixture<T>(files: string[], fn: () => T): T {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "webpack-configuration-test-"));
    const previousCwd = cwd();
    try {
        for (const filePath of files) {
            const absolutePath = join(fixtureDirectory, filePath);
            mkdirSync(dirname(absolutePath), {recursive: true});
            writeFileSync(absolutePath, "");
        }
        chdir(fixtureDirectory);
        return fn();
    } finally {
        chdir(previousCwd);
        rmSync(fixtureDirectory, {recursive: true, force: true});
    }
}

test("collects entries from src/scripts and excludes declaration files", () => {
    const parameters = inFixture(
        [
            "src/scripts/index.ts",
            "src/scripts/admin.ts",
            "src/scripts/types.d.ts",
            "src/scripts/nested/ignored.ts",
        ],
        generateParameters,
    );

    assert.deepEqual(parameters.entry, {
        index: "./src/scripts/index.ts",
        admin: "./src/scripts/admin.ts",
    });
});

test("maps html documents to pages with underscore-joined chunk names", () => {
    const parameters = inFixture(
        [
            "src/index.html",
            "src/about/index.html",
            "src/scripts/index.ts",
        ],
        generateParameters,
    );

    const htmlPages = parameters.htmlPages.toSorted(
        (a, b) => a.filename.localeCompare(b.filename)
    );

    assert.deepEqual(htmlPages, [
        {
            template: "src/about/index.html",
            filename: "about/index.html",
            chunks: ["about_index"],
        },
        {
            template: "src/index.html",
            filename: "index.html",
            chunks: ["index"],
        },
    ]);
});

test("returns empty parameters when no sources exist", () => {
    const parameters = inFixture([], generateParameters);

    assert.deepEqual(parameters.entry, {});
    assert.deepEqual(parameters.htmlPages, []);
});
