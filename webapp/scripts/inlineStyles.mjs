import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// Keep startup and app styling in the same deployed response as index.html.
// A stale/missing CSS asset or an incorrect CDN MIME type cannot strip the UI.
export async function inlineStyles(distDirectory) {
  const indexPath = resolve(distDirectory, "index.html");
  const html = await readFile(indexPath, "utf8");
  const replacements = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:[a-z]+:)?\/\//i.test(href)) continue;
    const assetPath = resolve(
      distDirectory,
      "." + new URL(href, "https://build.invalid/").pathname,
    );
    const fromDist = relative(resolve(distDirectory), assetPath);
    if (fromDist.startsWith("..") || isAbsolute(fromDist))
      throw new Error("Stylesheet is outside dist");
    const css = await readFile(assetPath, "utf8");
    // HTML's raw-text parser must not interpret a CSS string as a closing tag.
    replacements.push([
      tag,
      `<style data-app-styles>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
    ]);
  }
  if (!replacements.length)
    throw new Error(
      "No local app stylesheet found: refusing to publish an unstyled build",
    );
  let output = html;
  for (const [tag, style] of replacements)
    output = output.replace(tag, () => style);
  await writeFile(indexPath, output);
  return replacements.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const count = await inlineStyles(
    fileURLToPath(new URL("../dist/", import.meta.url)),
  );
  console.log(`Embedded ${count} app stylesheet(s) into index.html`);
}
