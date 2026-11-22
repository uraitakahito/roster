// tpm infra …: インフラの環境の宣言と承認を見る・書く。tpm guard: hook から呼ばれる guard。
import { OWN_LABEL } from '../config.ts';
import type { Context } from '../context.ts';
import { recordGuardStop } from '../evidence.ts';
import { commandOf, judge, judgeEnv, judgeWrite, readApprovals, removeApproval, writeApproval, writeOf, type Verdict } from '../guard.ts';
import { ROLE_NAMES, type RoleName } from '../protocol.ts';
import { requireTpmSide } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { castlistGuard } from './castlist.ts';
import { pagesDir } from './store.ts';

const GUARD_LABEL = { 'free': '自由', 'tpm': 'TPM に相談（DevOps Engineer 担当だけ）', 'pm': 'PM の承認（DevOps Engineer 担当だけ）', 'pm-only': 'PM だけ（どの担当も打てない）' } as const;

/** 打った担当。$TPM_ROLE が無ければ、TPM 担当か、tpm が起こしていない session。 */
export function roleOf(env: NodeJS.ProcessEnv): RoleName | undefined {
  return (ROLE_NAMES as string[]).includes(env.TPM_ROLE ?? '') ? env.TPM_ROLE as RoleName : undefined;
}

function requireEnv(ctx: Context, name: string) {
  const env = ctx.config.infra[name];
  if (env === undefined) throw new TpmError(`設定の infra に環境がありません: ${name}（tpm infra list で見る）`);
  return env;
}

/** 承認を書いてよいのは TPM 担当だけ（Product Manager が決めた後に書く）。 */
const requireApprover = (ctx: Context, command: string): void => requireTpmSide(ctx, command, '承認を書くのは TPM 担当です（Product Manager が決めた後）。担当は tpm ask pm で頼んでください');

/** 設定にある環境と手続き、「PM の承認」の環境なら今の承認を並べる（`tpm infra list`）。 */
export function infraList(ctx: Context): string[] {
  const names = Object.keys(ctx.config.infra);
  if (names.length === 0) return ['環境の宣言は無い（設定の infra に書く）'];
  const approvals = readApprovals(ctx.state, ctx.config.infra);
  return names.map((name) => {
    const env = requireEnv(ctx, name);
    const approval = approvals[name];
    const open = approval !== undefined && ctx.now().getTime() < Date.parse(approval.until);
    const state = env.guard !== 'pm' ? '' : open ? `  承認あり（${approval.until} まで${approval.note ? `・${approval.note}` : ''}）` : '  承認なし';
    // 直下の folder の設定の宣言なら、どの設定かを添える。
    const from = (env.from ?? []).some(f => f !== OWN_LABEL) ? `  宣言: ${(env.from ?? []).join('・')}` : '';
    return `- ${name}  ${GUARD_LABEL[env.guard]}${state}  match: ${env.match.map(m => JSON.stringify(m)).join(' ')}${from}`;
  });
}

/** 「PM の承認」の環境に、minutes 分だけ効く承認を書く（`tpm infra approve`）。TPM 担当だけが打てる。 */
export function infraApprove(ctx: Context, name: string, options: { minutes: number, note?: string }): string[] {
  requireApprover(ctx, 'tpm infra approve');
  const guardOf = requireEnv(ctx, name).guard;
  if (guardOf === 'pm-only') throw new TpmError(`環境 ${name} の手は Product Manager だけのものなので、承認を書いても担当は打てません（Product Manager が自分の terminal で直に打つ）`);
  if (guardOf !== 'pm') throw new TpmError(`環境 ${name} の手続きは「PM の承認」ではないので、承認は要りません`);
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) throw new TpmError('--minutes は 1 以上の数にしてください');
  const until = new Date(ctx.now().getTime() + options.minutes * 60_000).toISOString();
  writeApproval(ctx.state, name, { until, ...(options.note === undefined ? {} : { note: options.note }) });
  return [`承認を書いた: ${name}（${until} まで）`];
}

/** 環境の承認を、切れる前に消す（`tpm infra revoke`）。TPM 担当だけが打てる。 */
export function infraRevoke(ctx: Context, name: string): string[] {
  requireApprover(ctx, 'tpm infra revoke');
  requireEnv(ctx, name);
  removeApproval(ctx.state, name);
  return [`承認を消した: ${name}`];
}

/** 環境の名前を名指して命令を打ち、打った記録を infra.jsonl に残す。match に当たらない命令も、同じ手続きで見る。 */
export function infraRun(ctx: Context, name: string, command: string[]): { lines: string[], status: number } {
  const env = requireEnv(ctx, name);
  if (command.length === 0) throw new TpmError('-- の後に、打つ命令を書いてください');
  const verdict = judgeEnv(name, env, roleOf(ctx.env), readApprovals(ctx.state, ctx.config.infra)[name], ctx.now());
  if (!verdict.allow) throw new TpmError(verdict.reason);
  const [cmd = '', ...args] = command;
  const r = ctx.exec(cmd, args);
  ctx.state.append('infra.jsonl', { at: ctx.now().toISOString(), env: name, role: roleOf(ctx.env), key: ctx.env.TPM_KEY, command, status: r.status });
  return { lines: [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(l => l !== ''), status: r.status };
}

/**
 * hook の標準入力を読んで決める。Bash と、file を書き替える道具のほかは通す。止めた命令は guard.jsonl に残す。
 * Bash は、手続きと道具の直打ちを見て通す物を、続けて castlist の分（castlistGuard。設定が無ければ何もしない）で見る。
 */
export function guard(ctx: Context, stdin: string): Verdict {
  const write = writeOf(stdin);
  if (write !== undefined) {
    const verdict = judgeWrite(write, roleOf(ctx.env), [
      { name: 'project の folder', dir: ctx.project },
      { name: '状態の folder', dir: ctx.state.dir },
      { name: 'ページの控えの folder', dir: pagesDir(ctx.env) },
    ]);
    if (!verdict.allow) recordGuardStop(ctx, `${write.tool} ${write.path ?? ''}`, verdict.reason);
    return verdict;
  }
  const command = commandOf(stdin);
  if (command === undefined) return { allow: true };
  const verdict = judge({ command, role: roleOf(ctx.env), config: ctx.config, approvals: readApprovals(ctx.state, ctx.config.infra), now: ctx.now() });
  const castlist = verdict.allow ? castlistGuard(ctx, stdin) : verdict;
  if (!castlist.allow) recordGuardStop(ctx, command, castlist.reason);
  return castlist;
}
