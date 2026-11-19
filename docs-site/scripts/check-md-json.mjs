// repo の Markdown の中の ```json の塊を見る（pnpm run format:check）。
//
// 1. JSON として読める（<id> などの置き字は、文字列の中にある限り読める）
// 2. Prettier（--parser json、既定の設定）で整えた形と同じ
//
// md の本文（表・日本語の折り返し）は Prettier に触らせないので、md を Prettier に掛けずに
// 塊だけを取り出して比べる。直すときは、塊を Prettier の --parser json に通した形に書き換える。
// 対象は git が追跡する *.md と、まだ add していない新しい *.md（.gitignore の外）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** md の中の ```json（~~~json も）の塊。リストの中で字下げされた塊は、字下げを落として返す */
function jsonBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^( *)(`{3,}|~{3,})\s*json\s*$/);
    if (!open) continue;
    const [, indent, fence] = open;
    const close = new RegExp(`^ *${fence[0]}{${fence.length},}\\s*$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !close.test(lines[j]); j++) {
      body.push(
        lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j],
      );
    }
    blocks.push({ line: i + 1, code: body.join("\n") + "\n" });
    i = j;
  }
  return blocks;
}

/** 塊 1 つの誤り（無ければ null） */
async function checkBlock(code) {
  try {
    JSON.parse(code);
  } catch (e) {
    return `JSON として読めない: ${e.message}`;
  }
  const formatted = await format(code, { parser: "json" });
  if (formatted !== code) return "Prettier（--parser json）の形と違う";
  return null;
}

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
  { cwd: REPO, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const errors = [];
let count = 0;
for (const f of files) {
  for (const b of jsonBlocks(readFileSync(join(REPO, f), "utf8"))) {
    count++;
    const error = await checkBlock(b.code);
    if (error) errors.push(`${f}:${b.line}: ${error}`);
  }
}
if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ check-md-json: ${count} 塊`);
