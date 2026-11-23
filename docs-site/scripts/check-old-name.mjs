// repo の字に、道具の古い名 tpm が残っていないかを見る（pnpm run check）。道具の名は 2026-11-23 に tpm から roster に
// 替えた（t-v28j）。命令の形（tpm <命令>）・入口の path（cli/bin/tpm）・道具を指す字（「tpm の命令」など）の残りを落とす。
//
// 替えなかった内の名は当てない（当てる前に字から外す）:
// - 状態と控えと設定の folder の名（~/.local/state/tpm・~/.local/share/tpm・~/.config/tpm）
// - 名の頭の tpm.（tpm.jsonc・castlist の鍵 tpm.person・ラベル tpm.key と tpm.role・issuer の tpm.<project>）
// - TPM 担当の skill /tpm（skills/tpm も）・cmux.json の hook の id tpm-banner・file の名 tpm-side
// - TPM 担当を指す値: roster ask tpm・roster wait tpm・--on tpm の 2 語目、引用符で囲んだ 'tpm'（役割の鍵・設定の "guard": "tpm"）
// 環境変数（TPM_KEY など）と TPM 担当は大文字なので、もとから当たらない。
//
// 見るのは git が追跡する物と add 前の新しい物（check-wording.mjs と同じ数え方）。lockfile と、この file と、
// 下の KEEP（切り替えの間だけ残す古い入口と、その試験）は見ない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = relative(REPO, fileURLToPath(import.meta.url));

/** 切り替えの間だけ残す古い入口と、その試験。全部の席を起こし直した後の PR で、file と一緒にここから消す。 */
const KEEP = ["cli/bin/tpm", "cli/test/old-entry.test.ts"];

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

/** 内の名。当てる前に字から外す。 */
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
  /(?<=(?:\bask|\bwait|--on|waiting:|waits on)[ \t]*)tpm(?![\w-])/g,
  /(?<!\bbin'?,\s?|\.name\()(['"])tpm\1/g,
  /file:tpm(?![\w-])/g,
  /\.tpm(?![\w-])/g,
  /(?<![\w-])tpm(?=\s*[,;)\]}=?!(]|:\s*(?:[A-Z{'"\[(]|undefined|string|w\b|[a-z]\w*\())/g,
  /(?<=command\(')tpm(?= <)/g,
  // 見出しの名・記録の値（ask-tpm・tpm-only・tag の tpm-self）、名の接頭辞の -tpm
  /(?<![\w-])(?:ask-tpm|tpm-only|tpm-self)(?![\w-])/g,
  /(?<=[\w>])-tpm(?![\w-])/g,
  // TPM 担当を指す Key・役割・待ちの相手の値
  /TPM 担当(?:の手の操作など)?は tpm/g,
  /(?<![\w-])tpm(?=（TPM 担当）| ?は ?TPM 担当)/g,
  /(?<=[|・（] ?)tpm(?=[|>・）。`])/g,
  /(?<=PM の手 |前: #1 |役割は |）は )tpm(?![\w-])/g,
  /(?<=['"\s])tpm(?=: turn=)/g,
  /(?<![\w-])tpm(?=\.[`\s-]|\\\.)/g,
  /(?<=\\\/)tpm(?=\/)/g,
  /(?<=\/s\/)tpm(?=\/)/g,
  /(?<=役割[（:] ?)tpm/g,
  /(?<=写しだけ )tpm/g,
  /(?<=\S  )tpm(?=  )/g,
  /(?<=[=:])tpm(?![\w-])/g,
  /(?<=[／/] ?)tpm(?=: 並べて)/g,
  // skill の folder と frontmatter の名（TPM 担当の skill）、状態・控え・設定の folder
  /(?<![\w.-])tpm\/(?=brief-template|SKILL|pages|banner|<)/g,
  /(?<=^name: )tpm$/g,
  /(?<=_HOME\/)tpm(?=\/)/g,
  /(?<=`)tpm(?=`（道具の名を roster に替えた後も)/g,
];
const OLD = /(?<![A-Za-z0-9_])tpm(?![A-Za-z0-9_])/;

/** 1 つの file の字を見て、古い名が残る行を返す。 */
export function checkOldName(file, text) {
  const errors = [];
  text.split("\n").forEach((line, i) => {
    const rest = INNER.reduce((s, re) => s.replace(re, ""), line);
    if (OLD.test(rest))
      errors.push(
        `${file}:${i + 1}: 道具の古い名 tpm がある（roster に替える。内の名なら check-old-name.mjs の INNER に足す）: ${line.trim()}`,
      );
  });
  return errors;
}

// 見張りが本当に当てるか・当ててはいけない物を当てないかを、毎回先に確かめる
const MUST_HIT = [
  "tpm hello",
  "`tpm page put <file>`",
  "/foo/bar/roster/cli/bin/tpm start",
  "join(root, 'cli', 'bin', 'tpm')",
  "guardSettings(join(bin, 'tpm'))",
  "tpm を動かす機械",
  "tpm の命令",
  ".name('tpm')",
  "~/.local/bin/tpm",
  "toThrow(/tpm close では閉じられません/)",
  "`tpm` の CLI",
  "tpm: $cli/node_modules がありません",
];
const MUST_PASS = [
  'roster ask tpm "…"',
  'roster wait tpm "merge"',
  "roster page reply <URL> --answered --on tpm",
  "~/.local/state/tpm/<project>/tpm.jsonc",
  "~/.local/share/tpm/pages",
  "~/.config/tpm/banner.jsonc",
  "join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'tpm')",
  "tpm.person:product-manager・tpm.key・tpm.role・tpm.<project>",
  "`tpm.${key}`",
  "最初の入力 /tpm",
  "skills/tpm/SKILL.md",
  "id tpm-banner・commands/tpm-side.ts",
  '"guard": "tpm"',
  "role === 'tpm'",
  "TPM 担当・TPM_KEY",
  "hello(w.tpm, TPM)・file:tpm・const tpm = createContext()",
  "function painting(tpm: Context)・{ tpm: { turn: 'pm-wait' } }",
];
for (const s of MUST_HIT)
  if (checkOldName("self", s).length === 0)
    throw new Error(`check-old-name の見張りが当てない: ${s}`);
for (const s of MUST_PASS)
  if (checkOldName("self", s).length > 0)
    throw new Error(`check-old-name の見張りが当ててしまう: ${s}`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO, encoding: "utf8" },
  )
    .split("\n")
    .filter(
      (f) =>
        f !== "" &&
        f !== SELF &&
        !KEEP.includes(f) &&
        !f.endsWith("pnpm-lock.yaml"),
    )
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
