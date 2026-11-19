import { expect, test } from 'vitest';
import { parseUpdatedDependencies, ecosystemFromBranch, depsFromCommits, versionsFromDiff, judge, exitCodeOf, EXIT } from './release-age.mjs';

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
const T0 = Date.parse('2026-11-16T00:00:00Z');
const fixed = (table: Record<string, string>) => (_eco: string, name: string, version: string) => Promise.resolve(table[`${name}@${version}`] ?? null);

test('1 つの依存を読む（indirect も）', () => {
  expect(parseUpdatedDependencies(single)).toEqual([{ name: 'brace-expansion', version: '1.1.22' }]);
});

test('group の複数の依存を読む', () => {
  const d = parseUpdatedDependencies(group);
  expect(d.map(x => `${x.name}@${x.version}`)).toEqual(['reviewdog/action-actionlint@1.84.1', 'reviewdog/action-shellcheck@1.35.1']);
  expect(d[0]?.updateType).toBe('version-update:semver-minor');
});

test('引用符に包まれた名前（@ で始まる）は引用符を外す', () => {
  const msg = single.replace('dependency-name: brace-expansion', 'dependency-name: "@vitest/ui"').replace('1.1.22', '\'5.1.0\'');
  expect(parseUpdatedDependencies(msg)).toEqual([{ name: '@vitest/ui', version: '5.1.0' }]);
});

test('pnpm-lock の差分から、新しく入る version を読む（依存の依存も・消えた version と変わらない行は読まない）', () => {
  const got = versionsFromDiff(pnpmDiff).map(d => `${d.name}@${d.version}`).sort();
  expect(got).toEqual(['@astrojs/starlight@0.43.1', '@babel/parser@7.29.14', 'astro@7.4.12']);
});

test('作り直しで本文が古い PR は、差分の version（新しい方）で数えて まだ になる', async () => {
  // 本文の 0.42.11 は 100 時間前、差分の 0.43.1 は 10 時間前の公開。本文で数えると対象になってしまう入力。
  const now = T0 + 100 * H;
  const lookup = fixed({
    '@astrojs/starlight@0.42.11': new Date(T0).toISOString(),
    '@astrojs/starlight@0.43.1': new Date(T0 + 90 * H).toISOString(),
    '@babel/parser@7.29.14': new Date(T0).toISOString(),
    'astro@7.4.12': new Date(T0).toISOString(),
  });
  const fromBody = await judge({ deps: parseUpdatedDependencies(single.replace('dependency-name: brace-expansion', 'dependency-name: "@astrojs/starlight"').replace('dependency-version: 1.1.22', 'dependency-version: 0.42.11')), ecosystem: 'npm', now, lookup });
  const fromDiff = await judge({ deps: versionsFromDiff(pnpmDiff), ecosystem: 'npm', now, lookup });
  expect(fromBody.eligible).toBe(true);
  expect(fromDiff.eligible).toBe(false);
});

test('package-lock.json の差分を読む', () => {
  const diff = `+++ b/package-lock.json
     "node_modules/@scope/a": {
-      "version": "1.0.0",
+      "version": "1.1.0",
+    "node_modules/b/node_modules/c": {
+      "version": "2.0.0",
`;
  expect(versionsFromDiff(diff).map(d => `${d.name}@${d.version}`)).toEqual(['@scope/a@1.1.0', 'c@2.0.0']);
});

test('yarn.lock の差分を読む（berry と classic）', () => {
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
  expect(versionsFromDiff(berry).map(d => `${d.name}@${d.version}`)).toEqual(['js-yaml@4.3.2']);
  expect(versionsFromDiff(classic).map(d => `${d.name}@${d.version}`)).toEqual(['@scope/x@1.0.1']);
});

test('workflow の uses をコメントの version で読む', () => {
  const diff = `+++ b/.github/workflows/ci.yml
-      - uses: reviewdog/action-actionlint@cfa6 # v1.80.8
+      - uses: reviewdog/action-actionlint@ae85 # v1.84.1
+      - uses: actions/checkout@v5
+      - uses: ./local-action
`;
  expect(versionsFromDiff(diff).map(d => `${d.name}@${d.version}`)).toEqual(['reviewdog/action-actionlint@1.84.1', 'actions/checkout@5']);
});

test('塊が無い本文は空', () => {
  expect(parseUpdatedDependencies('fix: 手で足した commit')).toEqual([]);
});

test('枝の名前から種類を決める', () => {
  expect(ecosystemFromBranch('dependabot/npm_and_yarn/development-dependencies-e90cdbc354')).toBe('npm');
  expect(ecosystemFromBranch('dependabot/github_actions/actions-c6c3ae8f15')).toBe('github-actions');
  expect(ecosystemFromBranch('dependabot/docker/node-26-alpine')).toBe('docker');
  expect(ecosystemFromBranch('fix/foo')).toBe('other');
});

test('Dependabot でない commit は読まず、後の commit の version で上書きする', () => {
  const deps = depsFromCommits([
    { author: 'dependabot[bot]', message: single },
    { author: 'someone', message: single.replace('1.1.22', '9.9.9') },
    { author: 'dependabot[bot]', message: single.replace('1.1.22', '1.1.23') },
  ]);
  expect(deps.map(d => d.version)).toEqual(['1.1.23']);
});

test('72 時間ちょうどで対象・1 分前は まだ', async () => {
  const deps = [{ name: 'a', version: '1.0.0' }];
  const lookup = fixed({ 'a@1.0.0': new Date(T0).toISOString() });
  const before = await judge({ deps, ecosystem: 'npm', now: T0 + 72 * H - 60_000, lookup });
  const at = await judge({ deps, ecosystem: 'npm', now: T0 + 72 * H, lookup });
  expect(before.eligible).toBe(false);
  expect(exitCodeOf(before)).toBe(EXIT.notYet);
  expect(at.eligible).toBe(true);
  expect(exitCodeOf(at)).toBe(EXIT.eligible);
  expect(at.eligibleAt).toBe(new Date(T0 + 72 * H).toISOString());
});

test('group は いちばん新しい公開 から数える', async () => {
  // 古い version は 100 時間前・新しい version は 50 時間前。古い方で数えると対象になってしまう入力。
  const now = T0 + 100 * H;
  const deps = [{ name: 'old', version: '1.0.0' }, { name: 'new', version: '2.0.0' }];
  const lookup = fixed({ 'old@1.0.0': new Date(T0).toISOString(), 'new@2.0.0': new Date(T0 + 50 * H).toISOString() });
  const r = await judge({ deps, ecosystem: 'npm', now, lookup });
  expect(r.eligible).toBe(false);
  expect(r.eligibleAt).toBe(new Date(T0 + 122 * H).toISOString());
});

test('公開の時刻を読めない version が 1 つでもあれば 判定できない', async () => {
  const deps = [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }];
  const r = await judge({ deps, ecosystem: 'npm', now: T0 + 1000 * H, lookup: fixed({ 'a@1.0.0': new Date(T0).toISOString() }) });
  expect(r.eligible).toBe('undetermined');
  expect(exitCodeOf(r)).toBe(EXIT.undetermined);
});

test('lookup が投げても 判定できない（道具の誤りにしない）', async () => {
  const r = await judge({ deps: [{ name: 'a', version: '1' }], ecosystem: 'npm', now: T0, lookup: () => Promise.reject(new Error('network')) });
  expect(r.eligible).toBe('undetermined');
});

test('hours を替えると eligibleAt も替わる', async () => {
  const deps = [{ name: 'a', version: '1.0.0' }];
  const lookup = fixed({ 'a@1.0.0': new Date(T0).toISOString() });
  const r = await judge({ deps, ecosystem: 'npm', now: T0 + 30 * H, lookup, hours: 24 });
  expect(r.eligible).toBe(true);
  expect(r.eligibleAt).toBe(new Date(T0 + 24 * H).toISOString());
});

test('依存が 0 なら 判定できない', async () => {
  const r = await judge({ deps: [], ecosystem: 'npm', now: T0, lookup: fixed({}) });
  expect(r.eligible).toBe('undetermined');
});
