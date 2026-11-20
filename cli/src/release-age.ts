// Dependabot の PR 1 本について、上げる依存の version が公開から決めた時間（既定 72 時間・`--hours` で替える）を過ぎたかを判定する。
//
//   node release-age.ts <owner>/<repo> <PR 番号> [--hours <時間>] [--now <ISO 時刻>]
//
// 判定の決まり:
//   - 数えるのは「依存の version の公開から」。PR の作成からではない。
//   - group の PR は、中の version のうち いちばん新しい公開 から数える。
//   - 公開の時刻を読めない version が 1 つでもあれば「判定できない」。
//
// 読む物: PR の差分（lockfile・workflow）で新しく入る version（依存の依存も含む）と、PR の枝の名前
// （dependabot/npm_and_yarn/… など）。差分から version が取れないときだけ、Dependabot が書いた commit の
// 本文の `updated-dependencies:` に戻る（本文は作り直しで古くなるので、先には使わない）。
// 公開の時刻は npm は `npm view <名前> time --json`、
// GitHub Actions は Release の published_at（無ければ tag の commit の日付）。
// Docker とほかの種類は読まない（判定できない を返す）。
//
// 出力は標準出力に JSON 1 つ。終了コード: 0 対象 / 10 まだ / 20 判定できない / 1 道具の誤り。
//
// skill は pnpm install もせずに `node release-age.ts` で直に動かす（Node が型を消して動かす）。
// そのため Node の組み込みだけを import し、消せる型だけを書く（tsconfig.json の erasableSyntaxOnly）。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface Dependency {
  name: string
  version?: string
  updateType?: string
  source?: 'lockfile' | 'workflow'
}

export interface Commit {
  author: string
  message: string
}

export type Lookup = (ecosystem: string, name: string, version: string) => Promise<string | null> | string | null;

export interface JudgeRow {
  name: string
  version: string | null
  publishedAt: string | null
  hours: number | null
}

export interface JudgeResult {
  eligible: boolean | 'undetermined'
  eligibleAt: string | null
  ecosystem: string
  deps: JudgeRow[]
}

export const HOURS = 72;
export const EXIT = { eligible: 0, notYet: 10, undetermined: 20, error: 1 } as const;

/** commit の本文から `updated-dependencies:` の塊を読む。無ければ空の配列。 */
export function parseUpdatedDependencies(message: string): Dependency[] {
  const lines = message.split('\n');
  const start = lines.findIndex(l => l.trim() === 'updated-dependencies:');
  if (start < 0) return [];
  const deps: Partial<Dependency>[] = [];
  let cur: Partial<Dependency> | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '...') break;
    const m = line.match(/^(-\s+|\s+)([a-z-]+):\s*(.*)$/);
    if (!m) continue;
    const [, lead = '', key, value = ''] = m;
    if (lead.startsWith('-')) {
      cur = {};
      deps.push(cur);
    }
    if (!cur) continue;
    // `@` で始まる名前は YAML の決まりで引用符に包まれて来る（"@vitest/ui"）。
    const v = value.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (key === 'dependency-name') cur.name = v;
    if (key === 'dependency-version') cur.version = v;
    if (key === 'update-type') cur.updateType = v;
  }
  return deps.filter((d): d is Dependency => Boolean(d.name));
}

/** 枝の名前から依存の種類を決める。 */
export function ecosystemFromBranch(ref: string): string {
  const kind = ref.match(/^dependabot\/([^/]+)\//)?.[1];
  if (!kind) return 'other';
  if (kind === 'npm_and_yarn') return 'npm';
  if (kind === 'github_actions') return 'github-actions';
  if (kind === 'docker') return 'docker';
  return kind;
}

/**
 * PR の差分（`gh pr diff` の字）から、この PR で新しく入る version を読む。
 * commit の本文の `updated-dependencies` は、group の PR が作り直されると古いまま残る
 * （実例: 本文は @astrojs/starlight 0.42.11、差分は 0.43.1）。version は差分から取る。
 *
 * 読む物（足された行 `+` だけ）:
 *   - pnpm-lock.yaml: 2 字下げの `'name@version':`・`name@version:`（packages と snapshots の鍵）
 *   - package-lock.json: `"node_modules/<name>": {` の下の `"version": "x"`
 *   - yarn.lock: berry の `resolution: "name@npm:x"`、classic の見出しの下の `version "x"`
 *   - GitHub Actions の workflow: `uses: owner/repo@<ref> # v1.2.3`（コメントの version、無ければ ref）
 * 依存の依存（lockfile にだけ出る version）も数える。新しく入る version はどれも、悪意のある version でありうるため。
 */
export function versionsFromDiff(diff: string): Dependency[] {
  const out = new Map<string, Dependency>();
  const add = (name: string | null | undefined, version: string | null | undefined, source: 'lockfile' | 'workflow') => {
    if (!name || !version) return;
    out.set(`${name}@${version}`, { name, version, source });
  };
  let file = '';
  let npmName: string | null = null; // package-lock.json の今の node_modules の名前
  let yarnName: string | null = null; // yarn classic の今の見出しの名前
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (b\/)?/, '');
      npmName = yarnName = null;
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('@@')) continue;
    const mark = raw[0];
    const line = raw.slice(1);
    const base = file.split('/').pop() ?? '';
    if (base === 'pnpm-lock.yaml') {
      if (mark !== '+') continue;
      const m = line.match(/^ {2}'?((?:@[^/@'\s]+\/)?[^@'\s(]+)@([0-9][^'(:\s]*)/);
      if (m && /:\s*$/.test(line)) add(m[1], m[2], 'lockfile');
    }
    else if (base === 'package-lock.json') {
      const h = line.match(/^\s*"(?:.*\/)?node_modules\/((?:@[^/"]+\/)?[^/"]+)":\s*\{/);
      if (h) npmName = h[1] ?? null;
      const v = line.match(/^\s*"version":\s*"([^"]+)"/);
      if (mark === '+' && v && npmName) add(npmName, v[1], 'lockfile');
    }
    else if (base === 'yarn.lock') {
      const r = line.match(/^\s+resolution:\s*"((?:@[^/@"]+\/)?[^@"]+)@npm:([^"]+)"/);
      if (mark === '+' && r) add(r[1], r[2], 'lockfile');
      const h = line.match(/^"?((?:@[^/@"]+\/)?[^@"\s]+)@[^:]*:\s*$/);
      if (h && !line.startsWith(' ')) yarnName = h[1] ?? null;
      const v = line.match(/^\s+version "([^"]+)"/);
      if (mark === '+' && v && yarnName) add(yarnName, v[1], 'lockfile');
    }
    else if (/\.ya?ml$/.test(base) && file.includes('.github/')) {
      if (mark !== '+') continue;
      const u = line.match(/uses:\s*([^@\s]+)@(\S+)(?:\s*#\s*v?(\S+))?/);
      if (u?.[1] && u[2] && !u[1].startsWith('./')) add(u[1].split('/').slice(0, 2).join('/'), u[3] ?? u[2].replace(/^v/, ''), 'workflow');
    }
  }
  return [...out.values()];
}

/** Dependabot の commit を古い順に読み、同じ名前は後の commit の version で上書きする。 */
export function depsFromCommits(commits: Commit[]): Dependency[] {
  const byName = new Map<string, Dependency>();
  for (const c of commits) {
    if (c.author !== 'dependabot[bot]') continue;
    for (const d of parseUpdatedDependencies(c.message)) byName.set(d.name, d);
  }
  return [...byName.values()];
}

/**
 * 判定の本体。lookup(ecosystem, name, version) は公開の時刻（ISO の字）か null を返す。
 * 外の呼び出しは lookup の中だけにして、試験では偽物に差し替える。
 */
export async function judge({ deps, ecosystem, now, lookup, hours = HOURS }: { deps: Dependency[], ecosystem: string, now: number, lookup: Lookup, hours?: number }): Promise<JudgeResult> {
  const rows: JudgeRow[] = [];
  for (const d of deps) {
    let publishedAt: string | null = null;
    if (d.version) {
      try {
        publishedAt = await lookup(ecosystem, d.name, d.version);
      }
      catch {
        publishedAt = null;
      }
    }
    const hours = publishedAt ? (now - Date.parse(publishedAt)) / 3_600_000 : null;
    rows.push({ name: d.name, version: d.version ?? null, publishedAt, hours: hours === null ? null : Math.round(hours * 10) / 10 });
  }
  const published = rows.flatMap(r => (r.publishedAt === null ? [] : [Date.parse(r.publishedAt)]));
  if (rows.length === 0 || published.length < rows.length) {
    return { eligible: 'undetermined', eligibleAt: null, ecosystem, deps: rows };
  }
  const newest = Math.max(...published);
  const eligibleAtMs = newest + hours * 3_600_000;
  return { eligible: now >= eligibleAtMs, eligibleAt: new Date(eligibleAtMs).toISOString(), ecosystem, deps: rows };
}

export function exitCodeOf(result: JudgeResult): number {
  if (result.eligible === 'undetermined') return EXIT.undetermined;
  return result.eligible ? EXIT.eligible : EXIT.notYet;
}

// ---- 外の呼び出し（本物） ----

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const npmTimes = new Map<string, Record<string, string>>(); // 同じ名前の version が lockfile に何度も出るので、名前ごとに 1 回だけ引く

export function realLookup(ecosystem: string, name: string, version: string): string | null {
  if (ecosystem === 'npm') {
    let times = npmTimes.get(name);
    if (!times) {
      times = JSON.parse(run('npm', ['view', name, 'time', '--json'])) as Record<string, string>;
      npmTimes.set(name, times);
    }
    return times[version] ?? null;
  }
  if (ecosystem === 'github-actions') {
    // 名前は owner/repo か owner/repo/中の path。tag は v の付く形と付かない形を試す。
    const [owner, repo] = name.split('/');
    for (const tag of [`v${version}`, version]) {
      try {
        return run('gh', ['api', `repos/${owner}/${repo}/releases/tags/${tag}`, '-q', '.published_at']).trim() || null;
      }
      catch {
        // 読めなければ次の形を試す
      }
      try {
        return run('gh', ['api', `repos/${owner}/${repo}/commits/${tag}`, '-q', '.commit.committer.date']).trim() || null;
      }
      catch {
        // 読めなければ次の形を試す
      }
    }
    return null;
  }
  return null; // docker とほかの種類は読まない
}

async function main(argv: string[]): Promise<number> {
  const [full, pr, ...rest] = argv;
  if (!full?.includes('/') || pr === undefined || !/^\d+$/.test(pr)) {
    console.error('使い方: release-age.ts <owner>/<repo> <PR 番号> [--hours <時間>] [--now <ISO 時刻>]');
    return EXIT.error;
  }
  const nowIdx = rest.indexOf('--now');
  const now = nowIdx >= 0 ? Date.parse(rest[nowIdx + 1] ?? '') : Date.now();
  if (Number.isNaN(now)) {
    console.error('--now の時刻が読めません');
    return EXIT.error;
  }
  const hoursIdx = rest.indexOf('--hours');
  const hours = hoursIdx >= 0 ? Number(rest[hoursIdx + 1]) : HOURS;
  if (!(hours > 0)) {
    console.error('--hours は正の数で');
    return EXIT.error;
  }
  const ref = run('gh', ['api', `repos/${full}/pulls/${pr}`, '-q', '.head.ref']).trim();
  const commits = JSON.parse(run('gh', ['api', `repos/${full}/pulls/${pr}/commits`, '--paginate', '-q', '[.[] | {author: (.author.login // ""), message: .commit.message}]'])) as Commit[];
  const ecosystem = ecosystemFromBranch(ref);
  // version は差分から取る。差分が読めない（大きすぎる等）か、差分に version が 1 つも無いときだけ commit の本文に戻る。
  let deps: Dependency[];
  let depsSource = 'diff';
  try {
    deps = versionsFromDiff(run('gh', ['pr', 'diff', pr, '--repo', full]));
  }
  catch {
    deps = [];
  }
  if (deps.length === 0) {
    deps = depsFromCommits(commits);
    depsSource = 'commit-message';
  }
  const result = await judge({ deps, ecosystem, now, lookup: realLookup, hours });
  console.log(JSON.stringify({ pr: `${full}#${pr}`, hours, depsSource, ...result }, null, 2));
  return exitCodeOf(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    (err: unknown) => {
      console.error(`道具の誤り: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(EXIT.error);
    },
  );
}
