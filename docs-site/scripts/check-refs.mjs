// 原稿（src/content/docs/）と repo の食い違いを見る。
//
// astro build は .md のページの中で何が落ちても exit 0 で終わるので、壊れたリンクや
// 消えたファイルの名指しは build では止まらない。ここで止める（pnpm run check）。
//
// 1. 本文の [x](/page/) の先のページが在る
// 2. 本文が code で名指した repo の path（repo の一番上の folder で始まる物）が在る
// 3. README のドキュメントの URL が、astro.config.ts の site ＋ base と同じ
// 4. skill（skill-sets/ の *.md）が名指す原稿が在り、「」で名指した見出しがその原稿に在る
// 5. configuration.md の「`.claude/dependabot/config.jsonc`」の表の欄と、skill が使う config.<欄> が両方向で揃う
// 6. 画面の絵（src/assets/screens/）と本文の参照が両方向で揃う
// 7. skill（SKILL.md）の本文の ${CLAUDE_SKILL_DIR}/… の先が在り、realpath "${CLAUDE_SKILL_DIR}/…" が repo の一番上を指す
// 8. skill（skill-sets/ の *.md）が「protocol.md の「見出し」」の形で _shared/ の決まりの見出しを名指したら、その見出しが在る
// 9. skill（skill-sets/ の *.md）に、連携と課題管理の道具の命令（cmux …・acli …）が直に書かれていない
// 10. skill・原稿・README が書いた roster <命令> が、cli/src/protocol.ts の COMMANDS に在る
// 11. skill が書いた見出し（【done】など）が cli/src/protocol.ts の HEADINGS に在り、HEADINGS の見出しがどれかの skill に在る
// 12. 本文の [x](/page/#見出し)・[x](#見出し) の見出しが、build した先のページ（dist/）に在る
//
// 7 が要るのは、skill が自分の folder からの相対パスで repo の中の物を読むため。folder を移して
// ../ の数がずれたときに、skill の読む先が無くなるのを止める。
//
// 8 が要るのは、担当どうしの決まり（_shared/）の節を別のファイルへ移したときに、その節を名指す
// skill の読む先が無くなるのを止めるため。
//
// 9〜11 が要るのは、担当のあいだの決まりを文（skill）とコード（cli/src）に分けて持つため。skill は roster の命令だけを書き、
// 道具の命令はコードの adapter が打つ。文に道具の命令が戻ったり、文とコードで命令や見出しの名がずれたりするのを止める。
// cli の依存（node_modules）を入れずに動くように、命令の木ではなく protocol.ts（Node の組み込みだけで読める）を読む。
//
// 12 が要るのは、1 がページしか見ないため。無い見出しへの link も build と 1 を通り、開くとページの頭に落ちる
// （2026-11-23 t-nxek の PR #182 で、docs の protocol に無い #思わぬ出来事 を書いて通った）。見出しの id は
// Starlight が見出しの字から作るので、作り方を真似ずに build の出力の id を読む。だから pnpm run check の build の後に流す。
//
// 4 と 5 が要るのは、skill が Pages ではなく原稿の Markdown を読むため。原稿の見出しや表を
// 直したときに、skill の読む先が無くなるのを止める。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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
        const slug = relative(DOCS, p)
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, "");
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
    if (!slugs.has(path))
      errors.push(`${relative(REPO, p.file)}: リンク先のページが無い: ${m[1]}`);
  }
}

// 2. repo の path の名指し。一番上の folder（隠しも含む）で始まる code だけを見る。
//    <…>・*・空白・$ を含む物は形の説明なので見ない。末尾の :<行> は落とす
//    在るかは手元の folder でなく git から求める。追跡する物と、まだ add していない新しい物（.gitignore の外）だけを
//    数え、手元だけの node_modules/ などは数えない（数えると手元では通り、CI で落ちる）
const tracked = execFileSync("git", ["ls-files"], {
  cwd: REPO,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const committable = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: REPO, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const known = new Set(
  committable.flatMap((f) =>
    f.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const inRepo = (path) => known.has(path.replace(/\/$/, ""));
// .claude/ は数えない。原稿の `.claude/…` は使う側の project（TPM 担当を起こす folder）の path を指す。
// この repo の .claude/roles/config.jsonc は、この repo を使う側として置いた物で、原稿が名指す物ではない
const topDirs = new Set(
  committable
    .filter((f) => f.includes("/"))
    .map((f) => f.split("/")[0])
    .filter((d) => d !== ".claude"),
);
for (const p of all) {
  for (const m of prose(p.text).matchAll(/`([^`\n]+)`/g)) {
    const code = m[1].replace(/:\d+(-\d+)?$/, "");
    if (/[<>*\s$]/.test(code) || !code.includes("/")) continue;
    if (!topDirs.has(code.split("/")[0])) continue;
    if (!inRepo(code))
      errors.push(`${relative(REPO, p.file)}: 名指した path が無い: ${code}`);
  }
}

// 3. README の URL
const config = readFileSync(join(SITE_DIR, "astro.config.ts"), "utf8");
const site = config.match(/^\s*site:\s*"([^"]+)"/m)?.[1];
const base = config.match(/^\s*base:\s*"([^"]+)"/m)?.[1];
const url = `${site}${base}/`;
const readme = readFileSync(join(REPO, "README.md"), "utf8");
const urls = [
  ...readme.matchAll(/https:\/\/uraitakahito\.github\.io\/[^\s)>]*/g),
].map((m) => m[0]);
if (!site || !base) errors.push("astro.config.ts: site か base が読めない");
else if (urls.length === 0)
  errors.push(`README.md: ドキュメントの URL（${url}）が無い`);
for (const u of urls) {
  if (!u.startsWith(url))
    errors.push(
      `README.md: URL が astro.config.ts の site ＋ base（${url}）と違う: ${u}`,
    );
}

// 4. skill が名指す原稿と見出し
const DOCS_IN_REPO = "docs-site/src/content/docs/";
const skillFiles = tracked.filter((f) => /^skill-sets\/.*\.md$/.test(f));
const headings = (text) =>
  new Set(
    [...prose(text).matchAll(/^#{2,6}\s+(.+?)\s*$/gm)].map((m) =>
      m[1].replace(/（[^）]*）$/, ""),
    ),
  );
const configFields = new Set();
for (const f of skillFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(
    new RegExp(
      `${DOCS_IN_REPO.replaceAll("/", "\\/")}([\\w-]+\\.md)\`?(?:\\s*の「(.+?)」)?`,
      "g",
    ),
  )) {
    const page = join(DOCS, m[1]);
    if (!existsSync(page)) {
      errors.push(`${f}: 名指した原稿が無い: ${DOCS_IN_REPO}${m[1]}`);
      continue;
    }
    if (m[2] && !headings(readFileSync(page, "utf8")).has(m[2])) {
      errors.push(`${f}: ${DOCS_IN_REPO}${m[1]} に見出し「${m[2]}」が無い`);
    }
  }
  for (const m of text.matchAll(/config\.([a-zA-Z]+)/g))
    if (m[1] !== "json" && m[1] !== "jsonc") configFields.add(m[1]);
}

// 5. config.jsonc の欄。見出しの下の最初の表の 1 列目を読む
const CONFIG_HEADING = "`.claude/dependabot/config.jsonc`";
const configuration = readFileSync(join(DOCS, "configuration.md"), "utf8");
const section = configuration
  .split(/^#{2,6}\s+/m)
  .find((s) => s.startsWith(`${CONFIG_HEADING}\n`));
if (!section) {
  errors.push(`configuration.md: 見出し「${CONFIG_HEADING}」が無い`);
} else {
  const rows = section
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .slice(2);
  const documented = new Set(
    rows.map((l) => l.split("|")[1].trim().replace(/^`|`$/g, "")),
  );
  for (const k of configFields)
    if (!documented.has(k))
      errors.push(`configuration.md: skill が使う config.${k} が表に無い`);
  for (const k of documented)
    if (!configFields.has(k))
      errors.push(`configuration.md: 表の欄 ${k} を使う skill が無い`);
}

// 6. 画面の絵
const SCREENS = join(SITE_DIR, "src", "assets", "screens");
const screens = existsSync(SCREENS)
  ? readdirSync(SCREENS).filter((f) => !f.startsWith("."))
  : [];
const used = new Set();
for (const p of all) {
  for (const m of prose(p.text).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = join(dirname(p.file), m[1]);
    if (!existsSync(target))
      errors.push(`${relative(REPO, p.file)}: 絵が無い: ${m[1]}`);
    else if (dirname(target) === SCREENS) used.add(relative(SCREENS, target));
  }
}
for (const f of screens)
  if (!used.has(f))
    errors.push(`docs-site/src/assets/screens/${f}: どの本文も使っていない`);

// 7. skill の中の相対パス。${CLAUDE_SKILL_DIR} は SKILL.md の在る folder
//    realpath "${CLAUDE_SKILL_DIR}/…" は <root> を求める書き方なので、repo の一番上と同じかを見る
const REPO_REAL = realpathSync(REPO);
for (const f of tracked.filter((t) => t.endsWith("/SKILL.md"))) {
  const skillDir = join(REPO, dirname(f));
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(
    /(realpath\s+"?)?\$\{CLAUDE_SKILL_DIR\}(\/[^\s"'`）)]*)/g,
  )) {
    const target = join(skillDir, m[2]);
    if (!existsSync(target)) {
      errors.push(
        `${f}: \${CLAUDE_SKILL_DIR}${m[2]} の先が無い（${relative(REPO, target) || "."}）`,
      );
    } else if (m[1] && realpathSync(target) !== REPO_REAL) {
      errors.push(
        `${f}: realpath "\${CLAUDE_SKILL_DIR}${m[2]}" が repo の一番上でなく ${relative(REPO, target)} を指す`,
      );
    }
  }
}

// 8. skill が名指す _shared/ の決まりの見出し。決まりのファイルは名だけで名指す（protocol.md の「連絡の仕方」）
const SHARED = "skill-sets/core/.claude/skills/_shared/";
const shared = new Map(
  tracked
    .filter((t) => t.startsWith(SHARED) && t.endsWith(".md"))
    .map((t) => [
      t.slice(SHARED.length),
      headings(readFileSync(join(REPO, t), "utf8")),
    ]),
);
for (const f of skillFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(/([\w-]+\.md)`?\s*の「(.+?)」/g)) {
    if (shared.has(m[1]) && !shared.get(m[1]).has(m[2]))
      errors.push(`${f}: ${SHARED}${m[1]} に見出し「${m[2]}」が無い`);
  }
}

// 9. skill に道具の命令を直に書かない（「cmux の表示」のような、命令でない字は数えない）
for (const f of skillFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(/\b(cmux|acli)\s+[a-z-]+/g))
    errors.push(
      `${f}: 道具の命令が直に書いてある: ${m[0]}（roster の命令に替える）`,
    );
}

// 10・11. 文とコードの揃い。protocol.ts は型の import だけなので、Node がそのまま読める
const { COMMANDS, HEADINGS } = await import(
  join(REPO, "cli", "src", "protocol.ts")
);
const groups = new Set(
  COMMANDS.filter((c) => c.includes(" ")).map((c) => c.split(" ")[0]),
);
const commandFiles = [
  ...skillFiles,
  "README.md",
  ...all.map((p) => relative(REPO, p.file)),
];
for (const f of commandFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  // roster の後に英小文字の語が続く所だけを命令とみる（roster --help・roster <命令>・「roster の命令」は数えない）
  for (const m of text.matchAll(
    /(?<![\w/=-])roster[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?/g,
  )) {
    const [, first, second] = m;
    if (groups.has(first)) {
      if (second && !COMMANDS.includes(`${first} ${second}`))
        errors.push(`${f}: roster ${first} ${second} という命令は無い`);
    } else if (!COMMANDS.includes(first)) {
      errors.push(`${f}: roster ${first} という命令は無い`);
    }
  }
}
const headingNames = new Set(Object.keys(HEADINGS));
const written = new Set();
for (const f of skillFiles) {
  const text = readFileSync(join(REPO, f), "utf8");
  for (const m of text.matchAll(/【([^】<>]+)】/g)) {
    written.add(m[1]);
    if (!headingNames.has(m[1]))
      errors.push(
        `${f}: 見出し【${m[1]}】が cli/src/protocol.ts の HEADINGS に無い`,
      );
  }
}
for (const name of headingNames)
  if (!written.has(name))
    errors.push(
      `cli/src/protocol.ts: HEADINGS の【${name}】を書いた skill が無い`,
    );

// 12. link の見出し（# の後ろ）
/** build した HTML の id をすべて返す */
function htmlIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}
/** 本文の link の見出しが、先のページの id に無ければ、誤りの文を返す。slug は本文のページ、idsOf(slug) は先のページの id（無いページは undefined） */
function anchorErrors(slug, text, idsOf) {
  const out = [];
  for (const m of prose(text).matchAll(/\]\(((?:\/[^)\s#]*)?)#([^)\s]+)\)/g)) {
    const target =
      m[1] === "" ? slug : m[1].split("?")[0].replace(/^\/|\/$/g, "");
    const ids = idsOf(target);
    if (!ids) continue; // 先のページが無いのは 1 が出す
    let id = m[2];
    try {
      id = decodeURIComponent(id);
    } catch {
      // % の形が崩れていれば、そのままの字で探す（無いので当たる）
    }
    if (!ids.has(id)) out.push(`リンク先の見出しが無い: ${m[1]}#${m[2]}`);
  }
  return out;
}

// 見張りが本当に当てるか・当ててはいけない物を当てないかを、毎回先に確かめる（check-wording.mjs と同じ形）
const FIXTURE = new Map([
  [
    "protocol",
    htmlIds('<h2 id="台帳">台帳</h2><h2 id="アクターの台帳castlist">'),
  ],
  ["operations", htmlIds('<h2 id="担当が落ちた後の調べ方">')],
]);
const ANCHOR_MUST_HIT = [
  "[担当のあいだの決まり](/protocol/#思わぬ出来事)",
  "[下](#無い見出し)",
];
const ANCHOR_MUST_PASS = [
  "[担当のあいだの決まり](/protocol/#台帳)",
  "[担当のあいだの決まり](/protocol/#%E5%8F%B0%E5%B8%B3)",
  "[アクターの台帳](/protocol/#アクターの台帳castlist)",
  "[下](#担当が落ちた後の調べ方)",
  "[担当のあいだの決まり](/protocol/)",
  "```md\n[x](/protocol/#無い見出し)\n```",
];
for (const s of ANCHOR_MUST_HIT)
  if (anchorErrors("operations", s, (slug) => FIXTURE.get(slug)).length === 0)
    throw new Error(`check-refs の見出しの見張りが当てない: ${s}`);
for (const s of ANCHOR_MUST_PASS)
  if (anchorErrors("operations", s, (slug) => FIXTURE.get(slug)).length > 0)
    throw new Error(`check-refs の見出しの見張りが当ててしまう: ${s}`);

const DIST = join(SITE_DIR, "dist");
const distIds = new Map();
const idsOf = (slug) => {
  if (!distIds.has(slug)) {
    const html = join(DIST, slug, "index.html");
    distIds.set(
      slug,
      existsSync(html) ? htmlIds(readFileSync(html, "utf8")) : undefined,
    );
  }
  return distIds.get(slug);
};
if (!existsSync(DIST))
  errors.push(
    "docs-site/dist: build の出力が無い（pnpm run check は astro build の後に流す）",
  );
else
  for (const p of all)
    for (const e of anchorErrors(p.slug, p.text, idsOf))
      errors.push(`${relative(REPO, p.file)}: ${e}`);

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ check-refs: ${all.length} ページ`);
