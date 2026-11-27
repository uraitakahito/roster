// 見張り（roster watch）の判じ方: GitHub に聞いた答えを読み、通った・落ちた・まだ・付いていない・応えない、に分ける。
// model を使わない。待つ・聞き直すのは commands/watch.ts。merge の後の main の workflow の判じ方は、roster report merged も使い、tag の push の回も同じ判じ方（judgeRuns）で見る。
import type { Exec } from './exec.ts';

/** PR の URL から読んだ repo と番号。 */
export interface PrRef {
  /** owner/repo。 */
  repo: string
  number: number
  url: string
}

const PR_URL = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** PR の URL を読む。PR の URL の形でなければ undefined。 */
export function parsePr(url: string): PrRef | undefined {
  const m = PR_URL.exec(url.trim());
  if (m?.[1] === undefined || m[2] === undefined) return undefined;
  return { repo: m[1], number: Number(m[2]), url: `https://github.com/${m[1]}/pull/${m[2]}` };
}

/**
 * 聞いた 1 回の答え。
 * - passed: みな終わって、落ちた物が無い（total は通った数。cancelled は、そのほかに取り消された main の workflow の数）。
 * - failed: 落ちた物がある（ほかがまだ動いていても、分かった時に返す。pending は、まだ動いている数。fresh は、merge から RUN_GRACE_MS の内で、回が作られきっていないかもしれない時）。
 * - pending: まだ終わっていない物がある（behind は、PR の head が、push した branch の先にまだ追いついていない時。done・total は 0）。
 * - none: 見る物（check・workflow の回）が 1 つも付いていない。「通った」ではない。
 * - unreachable: GitHub が応えない（繋がらない・5xx など）。聞き直せば変わりうる。
 * - invalid: 聞き直しても変わらない誤り（PR が無い・認証が無い・merge していない）。
 */
export type Look =
  | { state: 'passed', total: number, cancelled?: number }
  | { state: 'failed', failed: Named[], passed: number, pending: number, fresh?: boolean }
  | { state: 'pending', done: number, total: number, behind?: boolean }
  | { state: 'none' }
  | { state: 'unreachable', message: string }
  | { state: 'invalid', message: string };

/** 落ちた check・workflow の名と、その URL。 */
export interface Named {
  name: string
  url?: string
}

/** 聞き直しても変わらない誤りの字（gh の stderr）: PR・repo が無い、認証や権限が無い。 */
const INVALID = /Could not resolve to a|no pull requests found|HTTP 404|HTTP 401|HTTP 403|gh auth login/i;
/** 上限に当たった時の字。GitHub は上限でも 403 を返すが、待てば変わるので「応えない」に数える（INVALID より先に見る）。 */
const LIMITED = /rate limit|secondary rate|abuse detection|HTTP 429/i;

const lastLine = (text: string): string => text.trim().split('\n').at(-1)?.trim() ?? '';

/** gh が落ちた時の答え: 聞き直しても変わらない誤りか、応えないか。 */
function failure(status: number, stderr: string, stdout: string): Look {
  const message = lastLine(stderr) || lastLine(stdout) || `gh が終了コード ${status} で終わった`;
  if (LIMITED.test(stderr)) return { state: 'unreachable', message };
  // gh の終了コード 4 は、認証が要る。
  return status === 4 || INVALID.test(stderr) ? { state: 'invalid', message } : { state: 'unreachable', message };
}

function parsed<T>(stdout: string): T | undefined {
  try {
    return JSON.parse(stdout) as T;
  }
  catch {
    return undefined;
  }
}

/** `gh pr checks --json` の 1 行（読む欄だけ）。 */
interface Check {
  name?: string
  bucket?: string
  link?: string
}

/**
 * PR の今の head の commit の check を 1 回見る（`gh pr checks <URL> --json name,bucket,link`）。
 * 数では判じない: 付いている check が、みな終わったかで判じる。gh は、まだの物があると終了コード 8、落ちた物があると 1 で終わるが、JSON は出すので、先に JSON を読む。
 */
export function lookChecks(exec: Exec, pr: PrRef): Look {
  const r = exec('gh', ['pr', 'checks', pr.url, '--json', 'name,bucket,link']);
  const checks = r.stdout.trim() === '' ? undefined : parsed<Check[]>(r.stdout);
  if (!Array.isArray(checks)) {
    if (/no checks reported/i.test(r.stderr)) return { state: 'none' };
    // gh が 0 で終わったのに JSON を読めない時は、「check が無い」と言い切らない（聞き直す）。
    if (r.status === 0) return { state: 'unreachable', message: 'gh pr checks の答えを読めない' };
    return failure(r.status, r.stderr, r.stdout);
  }
  if (checks.length === 0) return { state: 'none' };
  const of = (...buckets: string[]): Check[] => checks.filter(c => buckets.includes(c.bucket ?? ''));
  const failed = of('fail', 'cancel');
  const pending = checks.length - of('pass', 'skipping', 'fail', 'cancel').length;
  if (failed.length > 0) {
    return { state: 'failed', failed: failed.map(c => ({ name: c.name ?? '（名無し）', ...(c.link ? { url: c.link } : {}) })), passed: of('pass', 'skipping').length, pending };
  }
  if (pending > 0) return { state: 'pending', done: checks.length - pending, total: checks.length };
  return { state: 'passed', total: checks.length };
}

/** `gh pr view --json state,headRefOid,headRefName,headRepository,headRepositoryOwner` の答え（読む欄だけ）。 */
interface HeadView {
  state?: string
  headRefOid?: string
  headRefName?: string
  headRepository?: { name?: string } | null
  headRepositoryOwner?: { login?: string } | null
}

/**
 * branch の先を引いた時に、比べずに進む答え。branch が無い（merge して消した・fork が消えた）・head の repo を読めない（上限でない 403。別の org の SAML・token の範囲の外）。
 * 比べは助けの手なので、読めない時は前のとおり check で判じる（見張れない、にしない）。
 */
const NO_BRANCH = /HTTP 404|HTTP 422|HTTP 403|No commit found/i;

/**
 * PR の head が、push した branch の先に追いついているかを 1 回見る（台帳 #340）。
 * push の直後は、PR の head（headRefOid）が前の commit のままで、`gh pr checks` が前の commit の check（落ちた回など）を返す。
 * - 追いついていない: pending（behind）。check は見ない。
 * - 追いついている・PR が開いていない・branch が無い・head の repo が無いか読めない: undefined（今のとおり check で判じる）。
 *   merge・close した PR は、GitHub が head を止めるが branch は進みうるので、比べない（比べると、いつまでも追いつかない）。
 * - GitHub が応えない（5xx・繋がらない・上限）: unreachable（聞き直す。比べずに進むと、揺れた時に #340 が戻る）。
 */
export function lookHead(exec: Exec, pr: PrRef): Look | undefined {
  const v = exec('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,headRefName,headRepository,headRepositoryOwner']);
  if (v.status !== 0) return failure(v.status, v.stderr, v.stdout);
  const view = parsed<HeadView>(v.stdout);
  if (typeof view?.state !== 'string' || typeof view.headRefOid !== 'string' || typeof view.headRefName !== 'string') return { state: 'unreachable', message: 'gh pr view の答えを読めない' };
  if (view.state !== 'OPEN') return undefined;
  const owner = view.headRepositoryOwner?.login;
  const name = view.headRepository?.name;
  if (owner === undefined || name === undefined) return undefined;
  const t = exec('gh', ['api', `repos/${owner}/${name}/commits/heads/${view.headRefName.split('/').map(encodeURIComponent).join('/')}`, '-q', '.sha']);
  if (t.status !== 0) {
    if (!LIMITED.test(t.stderr) && NO_BRANCH.test(t.stderr)) return undefined;
    return failure(t.status, t.stderr, t.stdout);
  }
  const tip = t.stdout.trim();
  if (tip === '') return { state: 'unreachable', message: 'branch の先の commit を読めない' };
  return tip === view.headRefOid ? undefined : { state: 'pending', done: 0, total: 0, behind: true };
}

/** `gh pr view --json state,mergeCommit,mergedAt` の答え（読む欄だけ）。 */
interface MergedView {
  state?: string
  mergeCommit?: { oid?: string } | null
  mergedAt?: string | null
}

/** `gh run list --json …` の 1 行（読む欄だけ）。 */
export interface Run {
  workflowName?: string
  status?: string
  conclusion?: string
  event?: string
  createdAt?: string
  url?: string
  headSha?: string
}

/** merge の直後、workflow の回がまだ作られていないとみなす長さ（ミリ秒）。この間は、回が無くても「まだ」。 */
export const RUN_GRACE_MS = 2 * 60_000;

/** 落ちたとみなさない結び（conclusion）。 */
const FINE = new Set(['success', 'skipped', 'neutral']);
/**
 * 取り消された回の結び。main の workflow では「落ちた」に数えない: 同じ concurrency の group（docs の pages など）で、
 * 後から来た回が、待っている回を取り消す（merge が続いた時。公開は後の回がする）。
 */
const CANCELLED = 'cancelled';

/**
 * merge した PR の、merge の commit で main に動いた workflow を 1 回見る。
 * - PR の check の回（pull_request の event）は数えない。
 * - workflow ごとに、いちばん新しい回で判じる（落ちた docs を `gh workflow run` で流し直した時は、新しい回を見る）。
 * - merge から RUN_GRACE_MS の間は、回が無くても・在る回がみな終わっていても「まだ」（回が、まだ作られきっていないことがある）。落ちた回は、その間でも返す。
 * - 回が 1 つも無いまま RUN_GRACE_MS を過ぎていれば none。
 * - 取り消された回（cancelled）は、落ちたにも通ったにも数えず、その数を cancelled に返す。
 */
export function lookMain(exec: Exec, pr: PrRef, now: Date): Look {
  const v = exec('gh', ['pr', 'view', pr.url, '--json', 'state,mergeCommit,mergedAt']);
  if (v.status !== 0) return failure(v.status, v.stderr, v.stdout);
  const view = parsed<MergedView>(v.stdout);
  // 読めない答えを「merge していない」と言い切らない（聞き直す）。
  if (typeof view?.state !== 'string') return { state: 'unreachable', message: 'gh pr view の答えを読めない' };
  const sha = view.mergeCommit?.oid;
  if (view.state !== 'MERGED' || sha === undefined) return { state: 'invalid', message: `PR はまだ merge されていません（state: ${view.state}）` };
  const r = exec('gh', ['run', 'list', '--repo', pr.repo, '--commit', sha, '--limit', '100', '--json', 'workflowName,status,conclusion,event,createdAt,url']);
  if (r.status !== 0) return failure(r.status, r.stderr, r.stdout);
  const runs = parsed<Run[]>(r.stdout);
  if (!Array.isArray(runs)) return { state: 'unreachable', message: 'gh run list の答えを読めない' };
  const merged = view.mergedAt ? Date.parse(view.mergedAt) : Number.NaN;
  // merge の時刻が読めない時も「merge の直後」に倒す（通った・無い、とは言わない）。
  const fresh = Number.isNaN(merged) || now.getTime() - merged < RUN_GRACE_MS;
  return judgeRuns(runs.filter(run => run.event !== 'pull_request' && run.event !== 'pull_request_target'), fresh);
}

/**
 * workflow の回の集まりを判じる（main の workflow・tag の push の回）。
 * - workflow ごとに、いちばん新しい回で判じる（落ちた回を `gh workflow run` で流し直した時は、新しい回を見る）。
 * - fresh（回が、まだ作られきっていないかもしれない）の間は、回が無くても・在る回がみな終わっていても「まだ」。落ちた回は、その間でも返す。
 * - 回が 1 つも無いまま fresh でなければ none。
 * - 取り消された回（cancelled）は、落ちたにも通ったにも数えず、その数を cancelled に返す。
 */
export function judgeRuns(runs: Run[], fresh: boolean): Look {
  const latest = new Map<string, Run>();
  for (const run of runs) {
    const name = run.workflowName ?? '（名無し）';
    const seen = latest.get(name);
    if (seen === undefined || (run.createdAt ?? '') > (seen.createdAt ?? '')) latest.set(name, run);
  }
  if (latest.size === 0) return fresh ? { state: 'pending', done: 0, total: 0 } : { state: 'none' };
  const all = [...latest.entries()];
  const running = all.filter(([, run]) => run.status !== 'completed');
  const cancelled = all.filter(([, run]) => run.status === 'completed' && run.conclusion === CANCELLED).length;
  const failed = all.filter(([, run]) => run.status === 'completed' && run.conclusion !== CANCELLED && !FINE.has(run.conclusion ?? ''));
  if (failed.length > 0) {
    return { state: 'failed', failed: failed.map(([name, run]) => ({ name, ...(run.url ? { url: run.url } : {}) })), passed: all.length - failed.length - running.length - cancelled, pending: running.length, ...(fresh ? { fresh } : {}) };
  }
  if (running.length > 0 || fresh) return { state: 'pending', done: all.length - running.length, total: all.length };
  return { state: 'passed', total: all.length - cancelled, ...(cancelled === 0 ? {} : { cancelled }) };
}

/** tag の名として受ける字（git の ref の名に使えない、空白・`~^:?*[` と逆斜線を含まない物）。 */
const TAG_NAME = /^[^\s~^:?*[\\]+$/;

/** tag を引いた時の、tag が無い答え。 */
const NO_TAG = /HTTP 404|HTTP 422|No commit found/i;

/**
 * tag の push で動いた workflow を 1 回見る（`roster watch tag`）。
 * - tag の commit の sha を引き（注釈付きの tag も commit の sha になる）、`--branch <tag> --event push` の回のうち、その sha の物だけを見る（消して打ち直した tag の古い回を数えない）。
 * - 判じ方は main と同じ（judgeRuns）。軽い tag には時刻が無いので、回が無い間は見張りを始めてから（since）、回が在る間はいちばん古い回が作られてから、RUN_GRACE_MS を「作られきっていない」とみなす。
 * - tag が無い: invalid。
 */
export function lookTag(exec: Exec, repo: string, tag: string, since: Date, now: Date): Look {
  const t = exec('gh', ['api', `repos/${repo}/commits/${['refs', 'tags', ...tag.split('/')].map(encodeURIComponent).join('/')}`, '-q', '.sha']);
  if (t.status !== 0) {
    if (!LIMITED.test(t.stderr) && NO_TAG.test(t.stderr)) return { state: 'invalid', message: `tag ${tag} が ${repo} に無い（push したか・名と repo が合っているかを見る）` };
    return failure(t.status, t.stderr, t.stdout);
  }
  const sha = t.stdout.trim();
  if (sha === '') return { state: 'unreachable', message: 'tag の commit を読めない' };
  const r = exec('gh', ['run', 'list', '--repo', repo, '--branch', tag, '--event', 'push', '--limit', '100', '--json', 'workflowName,status,conclusion,event,createdAt,url,headSha']);
  if (r.status !== 0) return failure(r.status, r.stderr, r.stdout);
  const runs = parsed<Run[]>(r.stdout);
  if (!Array.isArray(runs)) return { state: 'unreachable', message: 'gh run list の答えを読めない' };
  const ours = runs.filter(run => run.headSha === sha);
  const first = Math.min(...ours.map(run => Date.parse(run.createdAt ?? '')).filter(n => !Number.isNaN(n)));
  const from = Number.isFinite(first) ? first : since.getTime();
  return judgeRuns(ours, now.getTime() - from < RUN_GRACE_MS);
}

/** tag の名の形を見る（違えば、その訳。合えば undefined）。 */
export function badTag(tag: string): string | undefined {
  return TAG_NAME.test(tag) && !tag.startsWith('-') ? undefined : `tag の名（v1.2.3 など）を書いてください: ${tag}`;
}

/** GitHub が応えるかを 1 回見る（repo があればその repo を読めるか。無ければ API が応えるかだけ: API が応えても、merge・push・Actions がまだ落ちていることはある）。 */
export function lookGithub(exec: Exec, repo?: string): Look {
  const r = exec('gh', repo === undefined ? ['api', 'rate_limit', '-q', '.rate.limit'] : ['api', `repos/${repo}`, '-q', '.full_name']);
  if (r.status === 0) return { state: 'passed', total: 1 };
  return failure(r.status, r.stderr, r.stdout);
}

/** 秒を「4 分 12 秒」の形にする。 */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

/** 落ちた物の並び（名と URL）。 */
export const namedList = (items: Named[]): string => items.map(f => (f.url === undefined ? f.name : `${f.name}（${f.url}）`)).join('・');
