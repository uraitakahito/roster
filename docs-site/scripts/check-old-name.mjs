// repo の字に、道具の古い名 tpm が残っていないかを見る（pnpm run check）。道具の名は 2026-11-23 に tpm から roster に
// 替えた（t-v28j）。命令の形（tpm <命令>）・入口の path（cli/bin/tpm）・道具を指す字（「tpm の命令」など）の残りを落とす。
//
// 替えなかった内の名は当てない（当てる前に字から外す）:
// - 状態と控えの folder の古い在り処（~/.local/state/tpm・~/.local/share/tpm。移す 1 行と古い名の symlink の知らせ。t-6ydg）と、設定の古い在り処 ~/.config/tpm（読まずに知らせる。t-4urw）
// - 名の頭の tpm.（tpm.jsonc・castlist の鍵 tpm.person・ラベル tpm.key と tpm.role・issuer の tpm.<project>）
// - TPM 担当の skill /tpm（skills/tpm も）・cmux.json の hook の前の id tpm-banner（t-6ydg で roster-banner に替え、残っていれば知らせる）・file の名 tpm-side
// - TPM 担当を指す値: roster ask tpm・roster wait tpm・--on tpm の 2 語目、引用符で囲んだ 'tpm'（役割の鍵・設定の "guard": "tpm"）
// TPM 担当は大文字なので、もとから当たらない。環境変数の古い名（TPM_KEY など。t-6ydg で ROSTER_* に替えた）は OLD_ENV で別に当てる。
//
// 見るのは git が追跡する物と add 前の新しい物（check-wording.mjs と同じ数え方）。lockfile と、この file は見ない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = relative(REPO, fileURLToPath(import.meta.url));

/** 命令の 1 語目（cli/src/protocol.ts の COMMANDS）。skill の名 /tpm の後に命令が続く形（試験の /tpm close … / など）は内の名とみなさない。 */
const COMMAND_WORDS = [
  ...new Set(
    [
      ...readFileSync(join(REPO, "cli", "src", "protocol.ts"), "utf8")
        .match(/export const COMMANDS = \[([\s\S]*?)\]/)[1]
        .matchAll(/'([a-z][a-z -]*)'/g),
    ].map((m) => m[1].split(" ")[0]),
  ),
].join("|");

/** 並べた値の中の tpm を内の名とみなす時に、隣に在るはずの値（役割・待ちの相手・手続き・状態の種類）。 */
const PEERS = [
  "pm",
  "review",
  "work",
  "free",
  "pm-only",
  "unknown",
  "software-engineer",
  "devops-engineer",
  "staff-engineer",
  "sustaining-engineer",
  "auditor",
].join("|");

/** 内の名。当てる前に字から外す（どの file にも掛ける）。 */
const INNER = [
  /(?:state|share|\.config)\/tpm(?![\w-])/g,
  /'(?:state|share|\.config)'\),? 'tpm'/g,
  /(?<![\w-])tpm\.(?=[A-Za-z<$*{])/g,
  new RegExp(
    `(?<![\\w.-]|bin)/tpm(?![\\w-]|[ \\t]+(?:${COMMAND_WORDS})(?![\\w-]))`,
    "g",
  ),
  /skills\/tpm(?![\w-])/g,
  /(?<![\w-])tpm-(?:banner|side)/g,
  // 2 語目の tpm（roster ask tpm・roster wait tpm・--on tpm）。後ろに命令が続く形（ask tpm hello）は外さない
  new RegExp(
    `(?<=(?:\\bask|\\bwait|--on|waiting:|waits on)[ \\t]*)tpm(?![\\w-]|[ \\t]+(?:${COMMAND_WORDS})(?![\\w-]))`,
    "g",
  ),
  /file:tpm(?![\w-])/g,
  // 欄の値の "tpm"（設定の "guard": "tpm"・役割の鍵 role: 'tpm' など）
  /(?<=:\s*)(["'])tpm\1/g,
  /(["'])tpm\1(?=\s*:)/g,
  /(?<=command\(')tpm(?= <)/g,
  // 見出しの名・記録の値（ask-tpm・tpm-only・tag の tpm-self）、名の接頭辞の -tpm
  /(?<![\w-])(?:ask-tpm|tpm-only|tpm-self)(?![\w-])/g,
  /(?<=[\w>])-tpm(?![\w-])/g,
  // TPM 担当を指す Key・役割・待ちの相手の値
  /TPM 担当(?:の手の操作など)?は tpm(?=[）)。、'"]|$)/g,
  /(?<![\w-])tpm(?=（TPM 担当）| ?は ?TPM 担当)/g,
  // 並べた値の 1 つ（隣に、並べる相手の値が在る時だけ）
  new RegExp(
    `(?<=(?:${PEERS})[ \\t]*[|・][ \\t]*)tpm(?![\\w-])|(?<![\\w-])tpm(?=[ \\t]*[|・][ \\t]*(?:${PEERS})(?![\\w-]))`,
    "g",
  ),
  /(?<=PM の手 |前: #1 |役割は |）は )tpm(?![\w-])/g,
  /(?<=['"\s])tpm(?=: turn=)/g,
  /(?<![\w-])tpm(?=\.[`\s-]|\\\.)/g,
  /(?<=\\\/)tpm(?=\/)/g,
  /(?<=\/s\/)tpm(?=\/)/g,
  /(?<=役割[（:] ?)tpm/g,
  /(?<=写しだけ )tpm/g,
  /(?<=\S  )tpm(?=  )/g,
  new RegExp(
    `(?<=(?:role|waiting|seat|on|by)[=:])tpm(?![\\w-]|[ \\t]+(?:${COMMAND_WORDS})(?![\\w-]))`,
    "g",
  ),
  /(?<=[／/] ?)tpm(?=: 並べて)/g,
  // skill の folder と frontmatter の名（TPM 担当の skill）、状態・控え・設定の folder
  /(?<![\w.-])tpm\/(?=brief-template|SKILL|pages|banner|<)/g,
  /(?<=^name: )tpm$/g,
  /(?<=_HOME\/)tpm(?=\/)/g,
  /(?<=`)tpm(?=`（道具の名を roster に替えた後も)/g,
];

/** code（.ts・.mjs・.js）にだけ掛ける内の名: 識別子（w.tpm・const tpm・tpm: Context）と、引用符で囲んだ値（役割の鍵・待ちの相手）。 */
const CODE_INNER = [
  /\.tpm(?![\w-])/g,
  /(?<![\w-])tpm(?=\s*[;)\]}?!]|\s*,\s*(?:[a-z]\w*[,)]|'|\{|$)|\s*=(?!=)|\s*\(|:\s*(?:Context|Party|string|undefined|w\b|[a-z]\w*\(|\{|\[|'|\())/g,
  /(?<=(?:const|let|function|\(|\{|,)\s*)tpm(?![\w-])/g,
  // 引用符の 'tpm'。道具を呼ぶ形（exec・spawn・which の引数・入口の path・命令の木の名）は外さない
  /(?<!(?:\bbin'?|exec\w*\(|spawn\w*\(|which\(|\.name\()\s*,?\s*)(['"])tpm\1(?!\s*,\s*\[)/g,
];
const CODE = /\.(?:ts|mjs|js)$/;
/** 環境変数の古い名（TPM_KEY など）。TPM 担当を指すコードの名（TPM_TITLE・TPM_COLOR・TPM_SETTINGS・TPM_PARTY）は当てない。 */
const OLD_ENV =
  /(?<![A-Za-z0-9_])TPM_(?!(?:TITLE|COLOR|SETTINGS|PARTY)(?![A-Z0-9_]))[A-Z][A-Z0-9_]*/;
/** 環境変数の古い名を、わざと書く file（古い名を読む所・その試験・移り方の docs）。後始末（t-6ydg の段 5）で減らす。 */
const OLD_ENV_FILES = new Set([
  "cli/src/env.ts",
  "cli/src/guard.ts",
  "cli/test/castlist.test.ts",
  "cli/test/cli.test.ts",
  "cli/test/env.test.ts",
  "cli/test/roster.test.ts",
  "cli/test/state.test.ts",
  "docs-site/src/content/docs/operations.md",
  "skill-sets/core/.claude/skills/audit-evidence/SKILL.md",
]);
const OLD = /(?<![A-Za-z0-9_])tpm(?![A-Za-z0-9_])/;

/** 1 つの file の字を見て、古い名が残る行を返す。 */
export function checkOldName(file, text) {
  const rules = CODE.test(file) ? [...INNER, ...CODE_INNER] : INNER;
  const errors = [];
  text.split("\n").forEach((line, i) => {
    const rest = rules.reduce((s, re) => s.replace(re, ""), line);
    if (OLD.test(rest))
      errors.push(
        `${file}:${i + 1}: 道具の古い名 tpm がある（roster に替える。内の名なら check-old-name.mjs の INNER に足す）: ${line.trim()}`,
      );
    if (!OLD_ENV_FILES.has(file) && OLD_ENV.test(line))
      errors.push(
        `${file}:${i + 1}: 環境変数の古い名 TPM_* がある（ROSTER_* に替える。古い名をわざと書く file なら check-old-name.mjs の OLD_ENV_FILES に足す）: ${line.trim()}`,
      );
  });
  return errors;
}

// 見張りが本当に当てるか・当ててはいけない物を当てないかを、毎回先に確かめる（[file の名, 字]）
const MUST_HIT = [
  ["a.md", "tpm hello"],
  ["a.md", "`tpm page put <file>`"],
  ["a.md", "/foo/bar/roster/cli/bin/tpm start"],
  ["a.ts", "join(root, 'cli', 'bin', 'tpm')"],
  ["a.ts", "guardSettings(join(bin, 'tpm'))"],
  ["a.md", "tpm を動かす機械"],
  ["a.md", "tpm の命令"],
  ["a.ts", ".name('tpm')"],
  ["a.md", "~/.local/bin/tpm"],
  ["a.ts", "toThrow(/tpm close では閉じられません/)"],
  ["a.md", "`tpm` の CLI"],
  ["a.sh", "tpm: $cli/node_modules がありません"],
  ["a.ts", "execFileSync('tpm', ['hello'])"],
  ["a.ts", 'spawnSync("tpm", args)'],
  ["a.ts", "process.stderr.write(`tpm: Node が見つかりません`)"],
  ["a.md", "tpm, roster の順"],
  ["a.md", "古い名 (tpm) は"],
  ["a.md", "tpm?"],
  ["a.md", "道具（tpm）の命令"],
  ["a.md", "道具・tpm・の名"],
  ["a.md", "alias tpm=roster"],
  ["a.md", "role=tpm hello"],
  ["a.md", "roster ask tpm hello"],
  ["a.md", "TPM 担当は tpm を打つ"],
  ["a.md", "export TPM_MODEL=claude-fable-5-2"],
  ["a.ts", "envOf(env, 'KEY') || env.TPM_KEY"],
  ["a.md", "`TPM_RAW=1` を付ける"],
];
const MUST_PASS = [
  ["a.md", 'roster ask tpm "…"'],
  ["a.md", 'roster wait tpm "merge"'],
  ["a.md", "roster page reply <URL> --answered --on tpm"],
  ["a.md", "~/.local/state/tpm/<project>/tpm.jsonc"],
  ["a.md", "~/.local/share/tpm/pages"],
  ["a.md", "~/.config/tpm/banner.jsonc"],
  [
    "a.ts",
    "join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'tpm')",
  ],
  ["a.md", "tpm.person:product-manager・tpm.key・tpm.role・tpm.<project>"],
  ["a.ts", "`tpm.${key}`"],
  ["a.md", "最初の入力 /tpm"],
  ["a.md", "skills/tpm/SKILL.md"],
  ["a.md", "id tpm-banner・commands/tpm-side.ts"],
  ["a.jsonc", '"guard": "tpm"'],
  ["a.ts", "role === 'tpm'"],
  ["a.md", "TPM 担当・ROSTER_KEY・TPM_TITLE・TPM_SETTINGS"],
  ["cli/src/env.ts", "env[`TPM_${name}`] と TPM_KEY"],
  ["a.ts", "hello(w.tpm, TPM)・file:tpm・const tpm = createContext()"],
  ["a.ts", "function painting(tpm: Context)・{ tpm: { turn: 'pm-wait' } }"],
  ["a.md", "待ちの相手（pm・review・tpm。既定は pm）"],
  ["a.md", "--on <pm|review|tpm>"],
  ["a.md", "（担当は課題の Key、TPM 担当は tpm）"],
  ["a.md", "tpm.role=tpm・role:tpm"],
];
for (const [file, s] of MUST_HIT)
  if (checkOldName(file, s).length === 0)
    throw new Error(`check-old-name の見張りが当てない: ${file}: ${s}`);
for (const [file, s] of MUST_PASS)
  if (checkOldName(file, s).length > 0)
    throw new Error(`check-old-name の見張りが当ててしまう: ${file}: ${s}`);

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
    return checkOldName(f, text);
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error(`${errors.length} 行`);
    process.exit(1);
  }
  console.log(
    `✓ check-old-name: ${files.length} file に道具の古い名 tpm は無い`,
  );
}
