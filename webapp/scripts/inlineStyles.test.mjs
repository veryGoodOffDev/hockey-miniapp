import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineStyles } from "./inlineStyles.mjs";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "hockey-css-"));
  try {
    await mkdir(join(directory, "assets"));
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("production HTML contains the actual CSS, preserves script/assets and tolerates attribute order", () =>
  fixture(async (directory) => {
    await writeFile(
      join(directory, "index.html"),
      '<head><link crossorigin href="/assets/app.css" rel="stylesheet"><link rel="icon" href="/favicon.ico"></head><script src="/assets/app.js"></script>',
    );
    await writeFile(
      join(directory, "assets/app.css"),
      ".frostLoader{background:url(/hockey-bg.webp)} .appShell{color:#fff}",
    );
    assert.equal(await inlineStyles(directory), 1);
    const result = await readFile(join(directory, "index.html"), "utf8");
    assert.match(result, /<style data-app-styles>\.frostLoader/);
    assert.match(result, /\.appShell\{color:#fff\}/);
    assert.doesNotMatch(result, /rel="stylesheet"/);
    assert.match(result, /src="\/assets\/app.js"/);
    assert.match(result, /rel="icon"/);
  }));

test("relative CSS links, multiple sheets, dollar characters and a closing-style string are preserved safely", () =>
  fixture(async (directory) => {
    await writeFile(
      join(directory, "index.html"),
      "<link rel='stylesheet' href='assets/a.css'><link rel='stylesheet' href='/assets/b.css'>",
    );
    await writeFile(
      join(directory, "assets/a.css"),
      '.a::after{content:"$& </style>"}',
    );
    await writeFile(join(directory, "assets/b.css"), ".b{color:blue}");
    assert.equal(await inlineStyles(directory), 2);
    const result = await readFile(join(directory, "index.html"), "utf8");
    assert.match(result, /\$&/);
    assert.equal((result.match(/<\/style>/g) || []).length, 2);
    assert.ok(result.includes("<\\/style>"));
    assert.match(result, /\.b\{color:blue\}/);
  }));

test("missing CSS fails the build and never writes partially styled HTML", () =>
  fixture(async (directory) => {
    const html = '<link rel="stylesheet" href="/assets/missing.css">';
    await writeFile(join(directory, "index.html"), html);
    await assert.rejects(inlineStyles(directory), /ENOENT/);
    assert.equal(await readFile(join(directory, "index.html"), "utf8"), html);
  }));

test("a build with no local stylesheet fails explicitly", () =>
  fixture(async (directory) => {
    await writeFile(join(directory, "index.html"), "<html></html>");
    await assert.rejects(inlineStyles(directory), /No local app stylesheet/);
  }));
