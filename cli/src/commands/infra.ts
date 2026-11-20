// tpm infra …: インフラの環境の宣言と承認を見る・書く。tpm guard: hook から呼ばれる門。
import type { Context } from '../context.ts';
import { commandOf, judge, judgeEnv, readApprovals, removeApproval, writeApproval, type Verdict } from '../guard.ts';
import { ROLE_NAMES, type RoleName } from '../protocol.ts';
import { TpmError } from '../skill-sets.ts';

const GUARD_LABEL = { free: '自由', tpm: 'TPM に相談（DevOps Engineer 担当だけ）', pm: 'PM の承認（DevOps Engineer 担当だけ）' } as const;

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
function requireTpmSide(ctx: Context): void {
  if (ctx.env.TPM_KEY) throw new TpmError('承認を書くのは TPM 担当です（Product Manager が決めた後）。担当は tpm ask pm で頼んでください');
}

export function infraList(ctx: Context): string[] {
  const names = Object.keys(ctx.config.infra);
  if (names.length === 0) return ['環境の宣言は無い（設定の infra に書く）'];
  const approvals = readApprovals(ctx.state, ctx.config.infra);
  return names.map((name) => {
    const env = requireEnv(ctx, name);
    const approval = approvals[name];
    const open = approval !== undefined && ctx.now().getTime() < Date.parse(approval.until);
    const state = env.guard !== 'pm' ? '' : open ? `  承認あり（${approval.until} まで${approval.note ? `・${approval.note}` : ''}）` : '  承認なし';
    return `- ${name}  ${GUARD_LABEL[env.guard]}${state}  match: ${env.match.map(m => JSON.stringify(m)).join(' ')}`;
  });
}

export function infraApprove(ctx: Context, name: string, options: { minutes: number, note?: string }): string[] {
  requireTpmSide(ctx);
  if (requireEnv(ctx, name).guard !== 'pm') throw new TpmError(`環境 ${name} の級は「PM の承認」ではないので、承認は要りません`);
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) throw new TpmError('--minutes は 1 以上の数にしてください');
  const until = new Date(ctx.now().getTime() + options.minutes * 60_000).toISOString();
  writeApproval(ctx.state, name, { until, ...(options.note === undefined ? {} : { note: options.note }) });
  return [`承認を書いた: ${name}（${until} まで）`];
}

export function infraRevoke(ctx: Context, name: string): string[] {
  requireTpmSide(ctx);
  requireEnv(ctx, name);
  removeApproval(ctx.state, name);
  return [`承認を消した: ${name}`];
}

/** 環境の名前を名指して命令を打ち、打った記録を infra.jsonl に残す。match に当たらない命令も、同じ級で見る。 */
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

/** hook の標準入力を読んで決める。Bash でなければ通す。 */
export function guard(ctx: Context, stdin: string): Verdict {
  const command = commandOf(stdin);
  if (command === undefined) return { allow: true };
  return judge({ command, role: roleOf(ctx.env), config: ctx.config, approvals: readApprovals(ctx.state, ctx.config.infra), now: ctx.now() });
}
