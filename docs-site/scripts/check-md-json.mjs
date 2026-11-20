// repo の Markdown の中の ```json と ```jsonc の塊と、*.jsonc の file を見る（pnpm run format:check）。
//
// 1. 読める（<id> などの置き字は、文字列の中にある限り読める）。json は JSON.parse、jsonc は tpm が
//    config.jsonc を読むのと同じ parseJsonc（cli/src/jsonc.ts。Node が型を消して動かす）で読む
// 2. Prettier（--parser json か jsonc、既定の設定）で整えた形と同じ
//
// md の本文（表・日本語の折り返し）は Prettier に触らせないので、md を Prettier に掛けずに
// 塊だけを取り出して比べる。直すときは、塊を Prettier の --parser json（jsonc）に通した形に書き換える。
// 対象は git が追跡する *.md・*.jsonc と、まだ add していない新しい物（.gitignore の外）。
// *.jsonc の file（.claude/roles/config.jsonc など）は、file 全体を 1 つの jsonc の塊として同じに見る。
// VS Code が末尾のカンマに警告を出さないのは .vscode/settings.json が .vscode/jsonc.schema.json を当てるから。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { parseJsonc } from "../../cli/src/jsonc.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** md の中の ```json・```jsonc（~~~ も）の塊。リストの中で字下げされた塊は、字下げを落として返す */
function jsonBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^( *)(`{3,}|~{3,})\s*(jsonc?)\s*$/);
    if (!open) continue;
    const [, indent, fence, parser] = open;
    const close = new RegExp(`^ *${fence[0]}{${fence.length},}\\s*$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !close.test(lines[j]); j++) {
      body.push(
        lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j],
      );
    }
    blocks.push({ line: i + 1, parser, code: body.join("\n") + "\n" });
    i = j;
  }
  return blocks;
}

/** 塊 1 つの誤り（無ければ null） */
async function checkBlock({ parser, code }) {
  try {
    if (parser === "jsonc") parseJsonc(code);
    else JSON.parse(code);
  } catch (e) {
    return `${parser === "jsonc" ? "JSONC" : "JSON"} として読めない: ${e.message}`;
  }
  const formatted = await format(code, { parser });
  if (formatted !== code) return `Prettier（--parser ${parser}）の形と違う`;
  return null;
}

/** git が追跡する物と、まだ add していない新しい物のうち、pattern に合う file */
const repoFiles = (pattern) =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", pattern],
    { cwd: REPO, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

const errors = [];
let count = 0;
for (const f of repoFiles("*.md")) {
  for (const b of jsonBlocks(readFileSync(join(REPO, f), "utf8"))) {
    count++;
    const error = await checkBlock(b);
    if (error) errors.push(`${f}:${b.line}: ${error}`);
  }
}
let fileCount = 0;
for (const f of repoFiles("*.jsonc")) {
  fileCount++;
  const code = readFileSync(join(REPO, f), "utf8");
  const error = await checkBlock({ parser: "jsonc", code });
  if (error) errors.push(`${f}: ${error}`);
}
if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ check-md-json: ${count} 塊・${fileCount} file`);
