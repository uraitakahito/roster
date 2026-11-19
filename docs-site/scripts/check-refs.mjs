// 原稿（src/content/docs/）と repo の食い違いを見る。
//
// astro build は .md のページの中で何が落ちても exit 0 で終わるので、壊れたリンクや
// 消えたファイルの名指しは build では止まらない。ここで止める（pnpm run check）。
//
// 1. 本文の [x](/page/) の先のページが在る
// 2. 本文が code で名指した repo の path（repo の一番上の folder で始まる物）が在る
// 3. README のドキュメントの URL が、astro.config.ts の site ＋ base と同じ
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE_DIR, "..");
const DOCS = join(SITE_DIR, "src", "content", "docs");

const errors = [];

/** docs の下の .md / .mdx をすべて返す（slug は拡張子と index を落とした path） */
function pages() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.mdx?$/.test(e.name)) {
        const slug = relative(DOCS, p).replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
        out.push({ file: p, slug, text: readFileSync(p, "utf8") });
      }
    }
  };
  walk(DOCS);
  return out;
}

/** fenced code block を落とした本文（図や例の中の字は名指しではない） */
function prose(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
}

const all = pages();
const slugs = new Set(all.map((p) => p.slug));

// 1. ページへのリンク
for (const p of all) {
  for (const m of prose(p.text).matchAll(/\]\((\/[^)\s]*)\)/g)) {
    const path = m[1].split(/[?#]/)[0].replace(/^\/|\/$/g, "");
    if (!slugs.has(path)) errors.push(`${relative(REPO, p.file)}: リンク先のページが無い: ${m[1]}`);
  }
}

// 2. repo の path の名指し。一番上の folder（隠しも含む）で始まる code だけを見る。
//    <…>・*・空白・$ を含む物は形の説明なので見ない。末尾の :<行> は落とす
const topDirs = new Set(
  readdirSync(REPO, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !["node_modules", "dist", ".git"].includes(e.name))
    .map((e) => e.name),
);
for (const p of all) {
  for (const m of prose(p.text).matchAll(/`([^`\n]+)`/g)) {
    const code = m[1].replace(/:\d+(-\d+)?$/, "");
    if (/[<>*\s$]/.test(code) || !code.includes("/")) continue;
    if (!topDirs.has(code.split("/")[0])) continue;
    if (!existsSync(join(REPO, code))) errors.push(`${relative(REPO, p.file)}: 名指した path が無い: ${code}`);
  }
}

// 3. README の URL
const config = readFileSync(join(SITE_DIR, "astro.config.ts"), "utf8");
const site = config.match(/^\s*site:\s*"([^"]+)"/m)?.[1];
const base = config.match(/^\s*base:\s*"([^"]+)"/m)?.[1];
const url = `${site}${base}/`;
const readme = readFileSync(join(REPO, "README.md"), "utf8");
const urls = [...readme.matchAll(/https:\/\/uraitakahito\.github\.io\/[^\s)>]*/g)].map((m) => m[0]);
if (!site || !base) errors.push("astro.config.ts: site か base が読めない");
else if (urls.length === 0) errors.push(`README.md: ドキュメントの URL（${url}）が無い`);
for (const u of urls) {
  if (!u.startsWith(url)) errors.push(`README.md: URL が astro.config.ts の site ＋ base（${url}）と違う: ${u}`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ check-refs: ${all.length} ページ`);
