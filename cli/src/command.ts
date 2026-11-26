// 利用者が写して打つ 1 行（cd と claude の命令）を組む。
import { join } from 'node:path';
import { busyMessage, castlistUrl, downMessage, missingCastlistWarning, PM_REF, registerPm, requireUp } from './castlist.ts';
import type { Context } from './context.ts';
import { guardSettings } from './guard.ts';
import { usesNats } from './mail.ts';
import { presentSettingsEnv, resolveSettings } from './settings.ts';
import { shellQuote } from './shell.ts';
import { envName } from './env.ts';
import { skillSetDir, TpmError } from './skill-sets.ts';

/**
 * dir に移って TPM 担当の claude を起こす 1 行を返す。model などは env から resolveSettings('tpm', …) で決める。
 * env に書いてある ROSTER_MODEL などは、1 行の頭（PATH の隣）に写す。`ROSTER_MODEL=… roster start` と 1 回だけ付けた値も、
 * TPM 担当の環境に入り、roster hello の状態と roster assign で起こす担当に効く（profile で export したときと揃う）。
 * core と追加の skill セットを --add-dir で足し、最初の入力は /tpm。--settings で guard（roster guard）の hook を付ける。
 * TPM 担当が roster を名前だけで打てるように、PATH の頭に roster の folder を足す（担当には roster run-role が同じことをする）。
 * --add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。
 * launch は、1 行の頭に足す起こしの印（startTpm が castlist を設定した時に渡す。字のまま足す）。
 * mail は、メッセージを NATS で渡す hook も付けるか（設定の messages が nats の時。guardSettings）。
 */
export function buildCommand(dir: string, root: string, skillSets: string[], env: NodeJS.ProcessEnv, launch: string[] = [], mail = false): string {
  const settings = resolveSettings('tpm', { env });
  const addDirs = ['core', ...skillSets].map(s => skillSetDir(root, s));
  const bin = join(root, 'cli', 'bin');
  const claude = ['claude', '--model', settings.model, '--effort', settings.effort, '--permission-mode', settings.permissionMode, '--settings', guardSettings(join(bin, 'roster'), undefined, mail), '--add-dir', ...addDirs, '--', '/tpm'];
  const assigns = [`PATH=${shellQuote(bin)}:"$PATH"`, ...presentSettingsEnv(env).map(([name, value]) => `${name}=${shellQuote(value)}`), ...launch];
  return `cd ${shellQuote(dir)} && ${assigns.join(' ')} ${claude.map(shellQuote).join(' ')}`;
}

/**
 * roster start: project（ctx.project）で TPM 担当を起こす 1 行を返す。castlist を設定していなければ buildCommand の 1 行だけ。
 * 設定していれば、起きているかを見て（止まっていれば 1 行を出さずに、Product Manager が打つ 1 行を添えて止める）、Product Manager を人のアクターとして登録し、
 * 1 行の頭に起こしの印を付ける: 起こしの id（打つたびに uuidgen で作る）・起こした者（Product Manager）・頼んだ model と effort・起こしたばかりの印。
 * warnings は、castlist の時計がずれている時の 1 行（標準出力の 1 行と分けて出す）。
 * alert は、castlist を設定していない時の警告の枠（強めて出す。missingCastlistWarning）。
 */
export async function startTpm(ctx: Context): Promise<{ warnings: string[], alert: string[], line: string }> {
  const settings = resolveSettings('tpm', { env: ctx.env });
  const url = castlistUrl(ctx);
  if (url === undefined) return { warnings: [], alert: missingCastlistWarning(ctx), line: buildCommand(ctx.project, ctx.root, ctx.skillSets, ctx.env, [], usesNats(ctx)) };
  const done = 'TPM 担当を起こす 1 行は出していません。';
  const after = ['打ってから、もう 1 度 roster start を打ってください。'];
  const warnings = await requireUp(ctx, done, after);
  const registered = await registerPm(ctx, url);
  if (registered.kind === 'busy') throw new TpmError(busyMessage(url, done));
  if (registered.kind === 'down') throw new TpmError(downMessage(ctx, url, done, after));
  if (registered.kind === 'refused') throw new TpmError(`castlist（${url}）が Product Manager の登録を断りました（${registered.code}: ${registered.error}）`);
  const launch = [
    `${envName('LAUNCH')}="$(uuidgen)"`,
    `${envName('LAUNCHED_BY')}=${shellQuote(PM_REF)}`,
    `${envName('LAUNCH_MODEL')}=${shellQuote(settings.model)}`,
    `${envName('LAUNCH_EFFORT')}=${shellQuote(settings.effort)}`,
    `${envName('LAUNCH_FRESH')}=1`,
  ];
  return { warnings, alert: [], line: buildCommand(ctx.project, ctx.root, ctx.skillSets, ctx.env, launch, usesNats(ctx)) };
}
