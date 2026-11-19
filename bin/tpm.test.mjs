// node --test bin/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tpm = join(here, "tpm");
const root = realpathSync(join(here, ".."));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tpm-test-")));

const run = (bin, args, cwd) => execFileSync(bin, args, { cwd, encoding: "utf8" }).trimEnd().split("\n");
const head = "claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions";

// .claude/roles/config.json に text を書いた folder を作る（text が null なら config.json を置かない）
let n = 0;
const folder = (text) => {
  const d = join(scratch, `f${n++}`);
  mkdirSync(join(d, ".claude", "roles"), { recursive: true });
  if (text !== null) writeFileSync(join(d, ".claude", "roles", "config.json"), text);
  return d;
};

test("folder を渡さなければ今いる folder で起こす", () => {
  const [dir] = run(tpm, ["--print"], scratch);
  assert.equal(dir, scratch);
});

test("渡した folder で起こす", () => {
  const [dir] = run(tpm, ["--print", scratch], root);
  assert.equal(dir, scratch);
});

test("config.json が無ければ core の束だけを --add-dir で足し、/tpm の前に -- を置く", () => {
  const [, cmd] = run(tpm, ["--print", folder(null)], scratch);
  assert.equal(cmd, `${head} --add-dir ${root}/core -- /tpm`);
});

test("packs の欄が無ければ core の束だけ", () => {
  const [, cmd] = run(tpm, ["--print", folder('{ "software-engineer": { "effort": "high" } }')], scratch);
  assert.equal(cmd, `${head} --add-dir ${root}/core -- /tpm`);
});

test("packs に書いた束も足し、/tpm に packs= で渡す", () => {
  const [, cmd] = run(tpm, ["--print", folder('{ "packs": ["dependabot"] }')], scratch);
  assert.equal(cmd, `${head} --add-dir ${root}/core ${root}/dependabot -- /tpm packs=dependabot`);
});

test("packs の core と重なりは 1 度だけ足す", () => {
  const [, cmd] = run(tpm, ["--print", folder('{ "packs": ["core", "dependabot", "dependabot"] }')], scratch);
  assert.equal(cmd, `${head} --add-dir ${root}/core ${root}/dependabot -- /tpm packs=dependabot`);
});

for (const [name, text, message] of [
  ["無い束", '{ "packs": ["nope"] }', /pack がありません: nope/],
  ["壊れた JSON", "{ packs: ", /JSON として読めません/],
  ["配列でない packs", '{ "packs": "dependabot" }', /packs は束の名前/],
  ["道を含む束の名前", '{ "packs": ["../x"] }', /packs は束の名前/],
]) {
  test(`${name}なら起こさずに止まる`, () => {
    const r = spawnSync(tpm, ["--print", folder(text)], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, message);
    assert.equal(r.stdout, "");
  });
}

test("symlink から呼んでも repo を正しく求める", () => {
  const link = join(scratch, "tpm-link");
  symlinkSync(tpm, link);
  const [, cmd] = run(link, ["--print"], scratch);
  assert.match(cmd, new RegExp(`--add-dir ${root}/core -- /tpm$`));
});

test("無い folder では起こさずに止まる", () => {
  const r = spawnSync(tpm, ["--print", join(scratch, "nope")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /folder がありません/);
});

test("引数が多すぎれば使い方を出す", () => {
  const r = spawnSync(tpm, ["a", "b"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});
