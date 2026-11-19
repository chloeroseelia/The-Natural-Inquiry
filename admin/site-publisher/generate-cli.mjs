import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { generateSite } from "./generate.js";

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function generateToDirectory({ manifestPath, siteRoot, outDir, allowInPlace = false }) {
  const root = resolve(siteRoot);
  const out = resolve(outDir);
  if (out === root && !allowInPlace) {
    throw new Error("Refusing to write into the site root. Choose a separate --out directory.");
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const readExisting = (relativePath) => {
    const target = resolve(root, relativePath);
    if (!isWithin(root, target)) throw new Error(`Path escapes the site root: ${relativePath}`);
    return existsSync(target) ? readFileSync(target, "utf8") : null;
  };

  const { files, report } = generateSite(manifest, { readExisting });
  for (const file of files) {
    const target = resolve(out, file.path);
    if (!isWithin(out, target)) throw new Error(`Refusing to write outside the output directory: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  return { files: files.map((file) => file.path), report };
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("generate-cli.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--allow-in-place") args.set(key, true);
    else args.set(key, process.argv[++index]);
  }
  const manifestPath = args.get("--manifest");
  const siteRoot = args.get("--site-root");
  const outDir = args.get("--out");
  if (!manifestPath || !siteRoot || !outDir) {
    console.error("Usage: node generate-cli.mjs --manifest <file> --site-root <dir> --out <dir> [--allow-in-place]");
    process.exit(2);
  }
  try {
    const result = await generateToDirectory({ manifestPath, siteRoot, outDir, allowInPlace: args.get("--allow-in-place") === true });
    console.log(JSON.stringify(result.report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
