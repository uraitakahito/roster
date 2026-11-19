// node --test release-age.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpdatedDependencies, ecosystemFromBranch, depsFromCommits, versionsFromDiff, judge, exitCodeOf, EXIT } from "./release-age.mjs";

// group の PR が作り直された実例の差分の抜き書き。commit の本文は starlight 0.42.11 だが、差分は 0.43.1。
const pnpmDiff = `diff --git a/docs-site/package.json b/docs-site/package.json
--- a/docs-site/package.json
+++ b/docs-site/package.json
-    "@astrojs/starlight": "^0.42.10",
+    "@astrojs/starlight": "^0.43.1",
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -10,7 +10,7 @@ importers:
-        specifier: ^0.42.10
-        version: 0.42.10(astro@7.4.8)
+        specifier: ^0.43.1
+        version: 0.43.1(astro@7.4.12)
-  '@astrojs/starlight@0.42.10':
-    resolution: {integrity: sha512-old}
+  '@astrojs/starlight@0.43.1':
+    resolution: {integrity: sha512-new}
+  '@babel/parser@7.29.14':
+    resolution: {integrity: sha512-x}
+  astro@7.4.12:
+    resolution: {integrity: sha512-y}
+  astro@7.4.12(@types/node@26.6.6):
+    dependencies:
   unchanged@1.0.0:
`;

const single = `chore(deps): bump brace-expansion in /sub/pkg

---
updated-dependencies:
- dependency-name: brace-expansion
  dependency-version: 1.1.22
  dependency-type: indirect
...

Signed-off-by: dependabot[bot] <support@github.com>`;

const group = `Build(deps): Bump the actions group across 1 directory with 2 updates

---
updated-dependencies:
- dependency-name: reviewdog/action-actionlint
  dependency-version: 1.84.1
  dependency-type: direct:production
  update-type: version-update:semver-minor
  dependency-group: actions
- dependency-name: reviewdog/action-shellcheck
  dependency-version: 1.35.1
  dependency-type: direct:production
  update-type: version-update:semver-minor
  dependency-group: actions
...
`;

const H = 3_600_000;
const T0 = Date.parse("2026-11-16T00:00:00Z");
const fixed = (table) => async (_eco, name, version) => table[`${name}@${version}`] ?? null;

test("1 つの依存を読む（indirect も）", () => {
  assert.deepEqual(parseUpdatedDependencies(single), [{ name: "brace-expansion", version: "1.1.22" }]);
});

test("group の複数の依存を読む", () => {
  const d = parseUpdatedDependencies(group);
  assert.deepEqual(d.map((x) => `${x.name}@${x.version}`), ["reviewdog/action-actionlint@1.84.1", "reviewdog/action-shellcheck@1.35.1"]);
  assert.equal(d[0].updateType, "version-update:semver-minor");
});

test("引用符に包まれた名前（@ で始まる）は引用符を外す", () => {
  const msg = single.replace("dependency-name: brace-expansion", 'dependency-name: "@vitest/ui"').replace("1.1.22", "'5.1.0'");
  assert.deepEqual(parseUpdatedDependencies(msg), [{ name: "@vitest/ui", version: "5.1.0" }]);
});

test("pnpm-lock の差分から、新しく入る版を読む（依存の依存も・消えた版と変わらない行は読まない）", () => {
  const got = versionsFromDiff(pnpmDiff).map((d) => `${d.name}@${d.version}`).sort();
  assert.deepEqual(got, ["@astrojs/starlight@0.43.1", "@babel/parser@7.29.14", "astro@7.4.12"]);
});

test("作り直しで本文が古い PR は、差分の版（新しい方）で数えて まだ になる", async () => {
  // 本文の 0.42.11 は 100 時間前、差分の 0.43.1 は 10 時間前の公開。本文で数えると対象になってしまう入力。
  const now = T0 + 100 * H;
  const lookup = fixed({
    "@astrojs/starlight@0.42.11": new Date(T0).toISOString(),
    "@astrojs/starlight@0.43.1": new Date(T0 + 90 * H).toISOString(),
    "@babel/parser@7.29.14": new Date(T0).toISOString(),
    "astro@7.4.12": new Date(T0).toISOString(),
  });
  const fromBody = await judge({ deps: parseUpdatedDependencies(single.replace("dependency-name: brace-expansion", 'dependency-name: "@astrojs/starlight"').replace("dependency-version: 1.1.22", "dependency-version: 0.42.11")), ecosystem: "npm", now, lookup });
  const fromDiff = await judge({ deps: versionsFromDiff(pnpmDiff), ecosystem: "npm", now, lookup });
  assert.equal(fromBody.eligible, true);
  assert.equal(fromDiff.eligible, false);
});

test("package-lock.json の差分を読む", () => {
  const diff = `+++ b/package-lock.json
     "node_modules/@scope/a": {
-      "version": "1.0.0",
+      "version": "1.1.0",
+    "node_modules/b/node_modules/c": {
+      "version": "2.0.0",
`;
  assert.deepEqual(versionsFromDiff(diff).map((d) => `${d.name}@${d.version}`), ["@scope/a@1.1.0", "c@2.0.0"]);
});

test("yarn.lock の差分を読む（berry と classic）", () => {
  const berry = `+++ b/sub/pkg/yarn.lock
+"js-yaml@npm:^4.3.2":
+  version: 4.3.2
+  resolution: "js-yaml@npm:4.3.2"
`;
  const classic = `+++ b/yarn.lock
 "@scope/x@^1.0.0":
-  version "1.0.0"
+  version "1.0.1"
`;
  assert.deepEqual(versionsFromDiff(berry).map((d) => `${d.name}@${d.version}`), ["js-yaml@4.3.2"]);
  assert.deepEqual(versionsFromDiff(classic).map((d) => `${d.name}@${d.version}`), ["@scope/x@1.0.1"]);
});

test("workflow の uses をコメントの版で読む", () => {
  const diff = `+++ b/.github/workflows/ci.yml
-      - uses: reviewdog/action-actionlint@cfa6 # v1.80.8
+      - uses: reviewdog/action-actionlint@ae85 # v1.84.1
+      - uses: actions/checkout@v5
+      - uses: ./local-action
`;
  assert.deepEqual(versionsFromDiff(diff).map((d) => `${d.name}@${d.version}`), ["reviewdog/action-actionlint@1.84.1", "actions/checkout@5"]);
});

test("塊が無い本文は空", () => {
  assert.deepEqual(parseUpdatedDependencies("fix: 手で足した commit"), []);
});

test("枝の名前から種類を決める", () => {
  assert.equal(ecosystemFromBranch("dependabot/npm_and_yarn/development-dependencies-e90cdbc354"), "npm");
  assert.equal(ecosystemFromBranch("dependabot/github_actions/actions-c6c3ae8f15"), "github-actions");
  assert.equal(ecosystemFromBranch("dependabot/docker/node-26-alpine"), "docker");
  assert.equal(ecosystemFromBranch("fix/foo"), "other");
});

test("Dependabot でない commit は読まず、後の commit の版で上書きする", () => {
  const deps = depsFromCommits([
    { author: "dependabot[bot]", message: single },
    { author: "someone", message: single.replace("1.1.22", "9.9.9") },
    { author: "dependabot[bot]", message: single.replace("1.1.22", "1.1.23") },
  ]);
  assert.deepEqual(deps.map((d) => d.version), ["1.1.23"]);
});

test("72 時間ちょうどで対象・1 分前は まだ", async () => {
  const deps = [{ name: "a", version: "1.0.0" }];
  const lookup = fixed({ "a@1.0.0": new Date(T0).toISOString() });
  const before = await judge({ deps, ecosystem: "npm", now: T0 + 72 * H - 60_000, lookup });
  const at = await judge({ deps, ecosystem: "npm", now: T0 + 72 * H, lookup });
  assert.equal(before.eligible, false);
  assert.equal(exitCodeOf(before), EXIT.notYet);
  assert.equal(at.eligible, true);
  assert.equal(exitCodeOf(at), EXIT.eligible);
  assert.equal(at.eligibleAt, new Date(T0 + 72 * H).toISOString());
});

test("group は いちばん新しい公開 から数える", async () => {
  // 古い版は 100 時間前・新しい版は 50 時間前。古い方で数えると対象になってしまう入力。
  const now = T0 + 100 * H;
  const deps = [{ name: "old", version: "1.0.0" }, { name: "new", version: "2.0.0" }];
  const lookup = fixed({ "old@1.0.0": new Date(T0).toISOString(), "new@2.0.0": new Date(T0 + 50 * H).toISOString() });
  const r = await judge({ deps, ecosystem: "npm", now, lookup });
  assert.equal(r.eligible, false);
  assert.equal(r.eligibleAt, new Date(T0 + 122 * H).toISOString());
});

test("公開の時刻を読めない版が 1 つでもあれば 判定できない", async () => {
  const deps = [{ name: "a", version: "1.0.0" }, { name: "b", version: "1.0.0" }];
  const r = await judge({ deps, ecosystem: "npm", now: T0 + 1000 * H, lookup: fixed({ "a@1.0.0": new Date(T0).toISOString() }) });
  assert.equal(r.eligible, "undetermined");
  assert.equal(exitCodeOf(r), EXIT.undetermined);
});

test("lookup が投げても 判定できない（道具の誤りにしない）", async () => {
  const r = await judge({ deps: [{ name: "a", version: "1" }], ecosystem: "npm", now: T0, lookup: async () => { throw new Error("network"); } });
  assert.equal(r.eligible, "undetermined");
});

test("hours を替えると eligibleAt も替わる", async () => {
  const deps = [{ name: "a", version: "1.0.0" }];
  const lookup = fixed({ "a@1.0.0": new Date(T0).toISOString() });
  const r = await judge({ deps, ecosystem: "npm", now: T0 + 30 * H, lookup, hours: 24 });
  assert.equal(r.eligible, true);
  assert.equal(r.eligibleAt, new Date(T0 + 24 * H).toISOString());
});

test("依存が 0 なら 判定できない", async () => {
  const r = await judge({ deps: [], ecosystem: "npm", now: T0, lookup: fixed({}) });
  assert.equal(r.eligible, "undetermined");
});
