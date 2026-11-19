// node --test bin/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tpm = join(here, "tpm");
const root = realpathSync(join(here, ".."));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tpm-test-")));

const run = (bin, args, cwd) => execFileSync(bin, args, { cwd, encoding: "utf8" }).trimEnd().split("\n");

test("folder を渡さなければ今いる folder で起こす", () => {
  const [dir] = run(tpm, ["--print"], scratch);
  assert.equal(dir, scratch);
});

test("渡した folder で起こす", () => {
  const [dir] = run(tpm, ["--print", scratch], root);
  assert.equal(dir, scratch);
});

test("repo を --add-dir で足し、/tpm の前に -- を置く", () => {
  const [, cmd] = run(tpm, ["--print"], scratch);
  assert.equal(cmd, `claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --add-dir ${root} -- /tpm`);
});

test("symlink から呼んでも repo を正しく求める", () => {
  const link = join(scratch, "tpm-link");
  symlinkSync(tpm, link);
  const [, cmd] = run(link, ["--print"], scratch);
  assert.match(cmd, new RegExp(`--add-dir ${root} -- /tpm$`));
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
