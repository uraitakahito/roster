// roster watch: PR の CI・merge の後の main の workflow・GitHub の戻りを、model を使わずに見張る。
// 担当は、この命令を裏で起こして手を止める（Claude Code の Bash の「裏で動かす」。命令が終わると、Claude Code が担当を起こし、終了コードを渡す）。
// 出す字は短くする（結果の 1〜数行だけ。途中の様子は出さない）。通ったかは、終了コードで分かる。
import type { Context } from '../context.ts';
import { envOf } from '../env.ts';
import { TpmError } from '../skill-sets.ts';
import { lookChecks, lookGithub, lookMain, namedList, parsePr, span, type Look, type PrRef } from '../watch.ts';

/**
 * 見張りの終了コード。使い方の誤りは commander が 2、決まりの誤り（TpmError）は 1 で終わるので、結果はそれと重ならない数にする。
 * 「check が付いていない」（none）は、「通った」（passed）にしない。
 */
export const WATCH_EXIT = { passed: 0, error: 1, failed: 10, timeout: 20, none: 30 } as const;

/** 見張りの種類。 */
export type WatchKind = 'pr' | 'main' | 'github';

/** 見張りの結果（出す行と終了コード）。 */
export interface WatchResult {
  code: number
  lines: string[]
}

/** 見張りの旗。 */
export interface WatchOptions {
  /** 見張る長さ（分）。0 なら、今の様子を 1 回見て、待たずに終わる。 */
  timeout?: number
}

/** 既定の長さ（分）。 */
export const WATCH_MINUTES: Readonly<Record<WatchKind, number>> = { pr: 30, main: 30, github: 120 };

/** 聞く間（ミリ秒）: 初めの間・延ばす倍率・長くてもこの間。 */
const FIRST_MS = 20_000;
const GROW = 1.5;
const MAX_MS = 60_000;
/** check が付くのを待つ長さ（ミリ秒）。過ぎても付かなければ、「付いていない」で終わる。 */
export const NONE_GRACE_MS = 5 * 60_000;
/**
 * 「通った」「戻った」とみなすのに要る、間を空けて続けて見た回数。1 度見ただけでは終えない:
 * 遅れて付く check・遅れて作られる回（PR を出してすぐ見張ると、作られた所までしか見えないことがある）と、GitHub の戻りかけの揺れのため。
 */
const STREAK = 2;

/** 見張りの記録（watch.jsonl の 1 行）。命令の字やメッセージは入れない。 */
export interface WatchRecord {
  /** 始めた時刻。 */
  at: string
  kind: WatchKind
  /** 見張った物（PR の URL・repo）。 */
  target: string
  /** 結果（Look の state。長さを過ぎた時は timeout）。 */
  result: Look['state'] | 'timeout'
  code: number
  /** 聞いた回数。 */
  polls: number
  /** 始めから終わりまでの秒。 */
  seconds: number
  key?: string
  role?: string
}

/** 見張りの記録の file。 */
export const WATCH_LOG = 'watch.jsonl';

interface Loop {
  kind: WatchKind
  target: string
  /** 1 回見る。 */
  look: () => Look
  /** 「通った」とみなすのに要る、続けて通った回数。 */
  streak: number
  /** 結果の行に書く、見た物の呼び名（check・workflow）。 */
  noun: string
  /** もう 1 度見張る時に打つ命令（長さを過ぎた時の行に書く）。 */
  again: string
}

function minutes(kind: WatchKind, options: WatchOptions): number {
  const m = options.timeout ?? WATCH_MINUTES[kind];
  if (!Number.isFinite(m) || m < 0) throw new TpmError('--timeout は、0 以上の分にしてください（0 は、今の様子を 1 回見て終わる）');
  return m;
}

/** 結果の行。 */
function report(loop: Loop, look: Look, timedOut: boolean, seconds: number): WatchResult {
  const waited = span(seconds);
  const retry = `もう 1 度見張るなら ${loop.again}。2 度続けて過ぎたら roster ask tpm`;
  switch (look.state) {
    case 'passed':
      if (timedOut) return { code: WATCH_EXIT.timeout, lines: [`まだ: ${loop.kind === 'github' ? 'GitHub は 1 度応えた' : `${loop.noun} ${look.total} つは終わっていた`}が、続けてもう 1 度は見ていない（${waited}）。${retry}`] };
      if (loop.kind === 'github') return { code: WATCH_EXIT.passed, lines: [`戻った: GitHub が応えた（${waited}）`] };
      return { code: WATCH_EXIT.passed, lines: [`通った: ${loop.noun} ${look.total} つ（${look.cancelled === undefined ? '' : `うち ${look.cancelled} つは取り消し。後の回が済ませたかは見ていない。`}${waited}）`] };
    case 'failed':
      return { code: WATCH_EXIT.failed, lines: [`落ちた: ${namedList(look.failed)}`, `ほかの ${loop.noun}: 通った ${look.passed}・まだ ${look.pending}（${waited}）`] };
    case 'pending':
      return { code: WATCH_EXIT.timeout, lines: [look.total === 0 ? `まだ: ${loop.noun} の回がまだ作られていない（${waited}）。${retry}` : look.done === look.total ? `まだ: ${loop.noun} ${look.total} つは終わっているが、merge から 2 分の内なので、回が作られきるのを待っている（${waited}）。${retry}` : `まだ: ${loop.noun} ${look.total} つのうち ${look.total - look.done} つが終わっていない（${waited}）。${retry}`] };
    case 'none':
      return { code: WATCH_EXIT.none, lines: [`${loop.noun} が付いていない（${waited}）。通ったのではない。repo に、ここで動く workflow が在るはずなら、${loop.again} でもう 1 度見張る`] };
    case 'unreachable':
      return { code: WATCH_EXIT.timeout, lines: [`まだ: GitHub が応えない（${waited}。最後の誤り: ${look.message}）。${retry}`] };
    case 'invalid':
      return { code: WATCH_EXIT.error, lines: [`見張れない: ${look.message}`] };
  }
}

/** 終わるまで（長さを過ぎるまで）聞き続ける。聞く間は、初めは短く、長く待つほど空ける。GitHub が応えない間も、止まらずに聞き直す。 */
async function watch(ctx: Context, loop: Loop, options: WatchOptions): Promise<WatchResult> {
  const limit = minutes(loop.kind, options) * 60_000;
  const start = ctx.now().getTime();
  let polls = 0;
  let streak = 0;
  let gap = FIRST_MS;
  const finish = (look: Look, timedOut: boolean): WatchResult => {
    const seconds = (ctx.now().getTime() - start) / 1000;
    const result = report(loop, look, timedOut, seconds);
    const key = envOf(ctx.env, 'KEY');
    const role = envOf(ctx.env, 'ROLE');
    const record: WatchRecord = {
      at: new Date(start).toISOString(),
      kind: loop.kind,
      target: loop.target,
      result: result.code === WATCH_EXIT.timeout ? 'timeout' : look.state,
      code: result.code,
      polls,
      seconds: Math.round(seconds),
      ...(key === undefined ? {} : { key }),
      ...(role === undefined ? {} : { role }),
    };
    ctx.state.append(WATCH_LOG, record);
    return result;
  };
  for (;;) {
    const look = loop.look();
    polls++;
    const elapsed = ctx.now().getTime() - start;
    streak = look.state === 'passed' ? streak + 1 : 0;
    if (look.state === 'failed' || look.state === 'invalid') return finish(look, false);
    if (look.state === 'passed' && (streak >= loop.streak || limit === 0)) return finish(look, false);
    if (look.state === 'none' && (limit === 0 || elapsed >= Math.min(NONE_GRACE_MS, limit))) return finish(look, false);
    // 長さに達したら終える。残りが聞く間より短ければ、残りだけ眠って、長さの所で最後に 1 度見る。
    if (elapsed >= limit) return finish(look, true);
    await ctx.sleep(Math.min(gap, limit - elapsed));
    gap = Math.min(Math.round(gap * GROW), MAX_MS);
  }
}

function prOf(url: string): PrRef {
  const pr = parsePr(url);
  if (pr === undefined) throw new TpmError(`PR の URL（https://github.com/<owner>/<repo>/pull/<番号>）を書いてください: ${url}`);
  return pr;
}

/** PR の今の head の commit の check が、みな終わるまで見張る（みな終わったのを、間を空けて 2 度見たら「通った」）。 */
export function watchPr(ctx: Context, url: string, options: WatchOptions = {}): Promise<WatchResult> {
  const pr = prOf(url);
  return watch(ctx, { kind: 'pr', target: pr.url, look: () => lookChecks(ctx.exec, pr), streak: STREAK, noun: 'check', again: `roster watch pr ${pr.url}` }, options);
}

/** merge した PR の、merge の commit で main に動いた workflow が、みな終わるまで見張る。 */
export function watchMain(ctx: Context, url: string, options: WatchOptions = {}): Promise<WatchResult> {
  const pr = prOf(url);
  return watch(ctx, { kind: 'main', target: pr.url, look: () => lookMain(ctx.exec, pr, ctx.now()), streak: STREAK, noun: 'main の workflow', again: `roster watch main ${pr.url}` }, options);
}

/** GitHub が応えるようになるまで見張る（続けて 2 度応えたら「戻った」）。 */
export function watchGithub(ctx: Context, options: WatchOptions & { repo?: string } = {}): Promise<WatchResult> {
  const { repo } = options;
  if (repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new TpmError(`--repo は <owner>/<repo> の形にしてください: ${repo}`);
  return watch(ctx, { kind: 'github', target: repo ?? 'github', look: () => lookGithub(ctx.exec, repo), streak: STREAK, noun: 'GitHub', again: `roster watch github${repo === undefined ? '' : ` --repo ${repo}`}` }, options);
}
