// repo の字（docs・skill・tpm の code と試験・README・workflow）に、読む人の機械や、ある人の手元を前提にした
// 言い方が無いかを見る（pnpm run check）。roster はだれの機械でも動かせる物として公開するので、「この Mac」のように
// 1 台を指す字や、ある人の home の path を書かない（2026-11-23 t-q5mh。castlist の ci/check-wording.sh と同じ考え）。
//
// 1. 語の Mac（macOS・MacOS は当てない）。機械は「tpm を動かす機械」、バナーは「通知のバナー」と書く
// 2. /Users/<名> と、それを folder の名にした -Users-<名>（見本の名 me は当てない）
//
// 見るのは git が追跡する物と add 前の新しい物（check-refs.mjs と同じ数え方）。lockfile と、この file は見ない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = relative(REPO, fileURLToPath(import.meta.url));
const RULES = [
  {
    re: /(^|[^A-Za-z])Mac([^A-Za-z]|$)/,
    hint: "1 台の機械を指す「Mac」がある。「tpm を動かす機械」、バナーは「通知のバナー」と書く",
  },
  {
    re: /[-/]Users[-/](?!me(?:[^A-Za-z]|$))[A-Za-z]/,
    hint: "ある人の home の path がある。見本の名は me にする（/Users/me）",
  },
];

/** 1 つの file の字を見て、当たった行を返す。 */
export function checkWording(file, text) {
  const errors = [];
  text.split("\n").forEach((line, i) => {
    for (const { re, hint } of RULES)
      if (re.test(line))
        errors.push(`${file}:${i + 1}: ${hint}: ${line.trim()}`);
  });
  return errors;
}

// 見張りが本当に当てるか・当ててはいけない物を当てないかを、毎回先に確かめる
const MUST_HIT = [
  "この Mac の外に写さない",
  "Mac のバナー",
  "置き場は Mac に 1 つ",
  "/Users/takahito/projects",
  "-Users-takahito-projects-ai",
];
const MUST_PASS = [
  "macOS の通知",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Users/me/roster",
  "-Users-me-my-work-app",
  "uraitakahito.github.io",
];
for (const s of MUST_HIT)
  if (checkWording("self", s).length === 0)
    throw new Error(`check-wording の見張りが当てない: ${s}`);
for (const s of MUST_PASS)
  if (checkWording("self", s).length > 0)
    throw new Error(`check-wording の見張りが当ててしまう: ${s}`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO, encoding: "utf8" },
  )
    .split("\n")
    .filter((f) => f !== "" && f !== SELF && !f.endsWith("pnpm-lock.yaml"))
    .filter((f) => !/\.(png|jpe?g|gif|ico|webp|pdf|woff2?)$/i.test(f));
  const errors = files.flatMap((f) => {
    let text;
    try {
      text = readFileSync(join(REPO, f), "utf8");
    } catch {
      return []; // 消した物（add 前に消した file）
    }
    return checkWording(f, text);
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.log(`✓ check-wording: ${files.length} file`);
}
