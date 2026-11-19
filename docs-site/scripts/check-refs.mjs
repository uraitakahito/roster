// 原稿（src/content/docs/）と repo の食い違いを見る。
//
// astro build は .md のページの中で何が落ちても exit 0 で終わるので、壊れたリンクや
// 消えたファイルの名指しは build では止まらない。ここで止める（pnpm run check）。
//
// 1. 本文の [x](/page/) の先のページが在る
// 2. 本文が code で名指した repo の path（repo の一番上の folder で始まる物）が在る
// 3. README のドキュメントの URL が、astro.config.ts の site ＋ base と同じ
// 4. skill（skill-sets/ の *.md）が名指す原稿が在り、「」で名指した見出しがその原稿に在る
// 5. configuration.md の「`.claude/dependabot/config.json`」の表の欄と、skill が使う config.<欄> が両方向で揃う
// 6. 画面の絵（src/assets/screens/）と本文の参照が両方向で揃う
// 7. skill（SKILL.md）の本文の ${CLAUDE_SKILL_DIR}/… の先が在り、realpath "${CLAUDE_SKILL_DIR}/…" が repo の一番上を指す
//
// 7 が要るのは、skill が自分の folder からの相対パスで repo の中の物を読むため。folder を移して
// ../ の数がずれたときに、skill の読む先が無くなるのを止める。
//
// 4 と 5 が要るのは、skill が Pages ではなく原稿の Markdown を読むため。原稿の見出しや表を
// 直したときに、skill の読む先が無くなるのを止める。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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
//    一番上の folder は git が追跡する物から求める（手元だけの dist/・node_modules/ などを数えない）
//    symlink はその物を見る（cli/bin/tpm は build 前は在らない cli/dist/cli.js を指す）
const inRepo = (path) => {
  try {
    lstatSync(join(REPO, path));
    return true;
  } catch {
    return false;
  }
};
const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
const topDirs = new Set(tracked.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
for (const p of all) {
  for (const m of prose(p.text).matchAll(/`([^`\n]+)`/g)) {
    const code = m[1].replace(/:\d+(-\d+)?$/, "");
    if (/[<>*\s$]/.test(code) || !code.includes("/")) continue;
    if (!topDirs.has(code.split("/")[0])) continue;
    if (!inRepo(code)) errors.push(`${relative(REPO, p.file)}: 名指した path が無い: ${code}`);
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

// 4. skill が名指す原稿と見出し
const DOCS_IN_REPO = "docs-site/src/content/docs/";
const skillFiles = tracked.filter((f) => /^skill-sets\/.*\.md$/.test(f));
const headings = (text) =>
  new Set([...prose(text).matchAll(/^#{2,6}\s+(.+?)\s*$/gm)].map((m) => m[1].replace(/（[^）]*）$/, "")));
const configFields = new Set();
for (const f of skillFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(new RegExp(`${DOCS_IN_REPO.replaceAll("/", "\\/")}([\\w-]+\\.md)\`?(?:\\s*の「(.+?)」)?`, "g"))) {
    const page = join(DOCS, m[1]);
    if (!existsSync(page)) {
      errors.push(`${f}: 名指した原稿が無い: ${DOCS_IN_REPO}${m[1]}`);
      continue;
    }
    if (m[2] && !headings(readFileSync(page, "utf8")).has(m[2])) {
      errors.push(`${f}: ${DOCS_IN_REPO}${m[1]} に見出し「${m[2]}」が無い`);
    }
  }
  for (const m of text.matchAll(/config\.([a-zA-Z]+)/g)) if (m[1] !== "json") configFields.add(m[1]);
}

// 5. config.json の欄。見出しの下の最初の表の 1 列目を読む
const CONFIG_HEADING = "`.claude/dependabot/config.json`";
const configuration = readFileSync(join(DOCS, "configuration.md"), "utf8");
const section = configuration.split(/^#{2,6}\s+/m).find((s) => s.startsWith(`${CONFIG_HEADING}\n`));
if (!section) {
  errors.push(`configuration.md: 見出し「${CONFIG_HEADING}」が無い`);
} else {
  const rows = section.split("\n").filter((l) => l.startsWith("|")).slice(2);
  const documented = new Set(rows.map((l) => l.split("|")[1].trim().replace(/^`|`$/g, "")));
  for (const k of configFields) if (!documented.has(k)) errors.push(`configuration.md: skill が使う config.${k} が表に無い`);
  for (const k of documented) if (!configFields.has(k)) errors.push(`configuration.md: 表の欄 ${k} を使う skill が無い`);
}

// 6. 画面の絵
const SCREENS = join(SITE_DIR, "src", "assets", "screens");
const screens = existsSync(SCREENS) ? readdirSync(SCREENS).filter((f) => !f.startsWith(".")) : [];
const used = new Set();
for (const p of all) {
  for (const m of prose(p.text).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = join(dirname(p.file), m[1]);
    if (!existsSync(target)) errors.push(`${relative(REPO, p.file)}: 絵が無い: ${m[1]}`);
    else if (dirname(target) === SCREENS) used.add(relative(SCREENS, target));
  }
}
for (const f of screens) if (!used.has(f)) errors.push(`docs-site/src/assets/screens/${f}: どの本文も使っていない`);

// 7. skill の中の相対パス。${CLAUDE_SKILL_DIR} は SKILL.md の在る folder
//    realpath "${CLAUDE_SKILL_DIR}/…" は <root> を求める書き方なので、repo の一番上と同じかを見る
const REPO_REAL = realpathSync(REPO);
for (const f of tracked.filter((t) => t.endsWith("/SKILL.md"))) {
  const skillDir = join(REPO, dirname(f));
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(/(realpath\s+"?)?\$\{CLAUDE_SKILL_DIR\}(\/[^\s"'`）)]*)/g)) {
    const target = join(skillDir, m[2]);
    if (!existsSync(target)) {
      errors.push(`${f}: \${CLAUDE_SKILL_DIR}${m[2]} の先が無い（${relative(REPO, target) || "."}）`);
    } else if (m[1] && realpathSync(target) !== REPO_REAL) {
      errors.push(`${f}: realpath "\${CLAUDE_SKILL_DIR}${m[2]}" が repo の一番上でなく ${relative(REPO, target)} を指す`);
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ check-refs: ${all.length} ページ`);
