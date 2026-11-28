// 担当を起こす: 名簿に書き、居場所を作って roster run-role を動かし、名乗るまで待つ。起こす前に決める物（設定に書いた担当の既定・課題の写し）も持つ。
// roster assign（tpm-side.ts）・roster audit start（audit.ts）・roster ask review（staff.ts の launchStaff。Staff Engineer 担当の席）が使う。
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { castlistUrl } from '../castlist.ts';
import { readRolesConfig, rolesConfigFile } from '../config.ts';
import type { Context } from '../context.ts';
import { modelStatus, ROLES, type RoleName } from '../protocol.ts';
import { readRole, writeRole, type RoleRecord } from '../roster.ts';
import { shellQuote } from '../shell.ts';
import { TpmError } from '../skill-sets.ts';
import { copyIssue, issueTracker } from './issue.ts';

/** 名乗ったかを見る間（ミリ秒）。 */
const HELLO_INTERVAL_MS = 2000;

/**
 * 居場所に色（役割の色。ROLES の color・TPM_COLOR）を付ける。色は飾りなので、付けられなくても止めずに 1 行で知らせる
 * （起こした席はもう動いていて宛先も名簿に書いてあり、名乗る席は名乗りを続ける）。
 */
export function paint(ctx: Context, address: string, color: string): string[] {
  try {
    ctx.seats.setColor(address, color);
  }
  catch (e) {
    return [`居場所の色（${color}）を付けられなかった: ${e instanceof Error ? e.message : String(e)}`];
  }
  return [];
}

/** 起こした担当が、待った間に名乗らなかった（居場所は作った後。信頼のダイアログなどで閉じたこともある）。 */
export class NotStartedError extends TpmError {}

/**
 * 名簿の行の担当を起こす: 名簿に書き、居場所を作って roster run-role を動かし、名乗るまで wait 秒待つ（0 なら待たない）。
 * again は起こし直しか（出す字が変わる）。more は、起こした行と folder の行の後に出す行。roster assign・roster audit start と、Staff Engineer 担当の席を起こす launchStaff（staff.ts）が使う。
 * castlist を設定していれば、起こしの id と、起こした者（launchedBy。castlist の付随する id）を名簿に書く（roster run-role が担当の環境変数にする）。
 * 状態の folder は symlink を解いて渡す（古い在り処の symlink を通って起きた担当が起こす席にも、新しい path を渡す。t-6ydg）。
 * description は題の下に出す説明。色は役割の表（ROLES の color）から、宛先を名簿に書いた後に付ける（paint）。
 * spawned は、居場所を作って宛先を名簿に書いた直後（名乗りを待つ前）に呼ぶ（起こす時に渡した頼みを、送った記録に残す所。messages.ts の recordLaunchAsk）。
 * 名乗らなかった回にも、頼みは残る（依頼書は名簿の行で渡してある）。spawned が誤りで止まっても、席は起こす（記録は、起こすことより軽い）。
 */
export async function launch(ctx: Context, record: RoleRecord, again: boolean, wait: number, more: string[] = [], launchedBy?: string, description?: string, spawned?: (record: RoleRecord) => void): Promise<string[]> {
  if (castlistUrl(ctx) !== undefined) {
    record.launch = randomUUID();
    if (launchedBy !== undefined) record.launchedBy = launchedBy;
  }
  writeRole(ctx, record);
  const command = [join(ctx.root, 'cli', 'bin', 'roster'), 'run-role', record.key, '--project', ctx.project, '--state', realpathSync(ctx.state.dir)].map(shellQuote).join(' ');
  record.address = ctx.seats.spawn({ title: record.title, cwd: record.cwd, command, ...(description === undefined ? {} : { description }) });
  writeRole(ctx, record);
  try {
    spawned?.(record);
  }
  catch {
    // 記録を書けなくても、席は起こしてある。
  }
  const head = [`${again ? '起こし直した' : '起こした'}: ${record.title}（${record.address}・${modelStatus(record.model, record.effort)}）`, `folder: ${record.cwd}`, ...more, ...paint(ctx, record.address, ROLES[record.role].color)];
  if (wait === 0) return [...head, '名乗り（roster hello）は待っていない'];
  for (let waited = 0; waited < wait * 1000; waited += HELLO_INTERVAL_MS) {
    if (readRole(ctx, record.key)?.helloAt !== undefined) return [...head, '名乗った（roster hello が来た）'];
    await ctx.sleep(HELLO_INTERVAL_MS);
  }
  if (readRole(ctx, record.key)?.helloAt !== undefined) return [...head, '名乗った（roster hello が来た）'];
  throw new NotStartedError(notStarted(ctx, record, wait));
}

/**
 * 設定に書いた担当の既定。欄ごとに、担当を起こす folder（--cwd）の設定が先、次に project の folder の設定。
 * 直下の folder の設定どうしは合わせない（担当は 1 人で値は 1 つなので、起こす folder で決める）。
 */
export function roleDefaults(ctx: Context, role: RoleName, cwd: string): Partial<Record<'model' | 'effort' | 'permissionMode', string>> {
  const dir = resolve(cwd);
  const here = dir === ctx.project ? {} : readRolesConfig(rolesConfigFile(dir)).roles[role];
  return { ...ctx.config.roles[role], ...here };
}

/**
 * 課題の写し（名簿に書く欄）。読める形の Key なら写しを置いて URL を、--no-issue-copy ならその訳を返す。読める形でなければ空。
 * 前の写しの欄は、どちらかに上書きするため両方を返す（undefined は消す）。
 */
export async function issueCopy(ctx: Context, issueKey: string, roleKey: string, skip: string | undefined): Promise<Pick<RoleRecord, 'issuePage' | 'issueCopySkipped'>> {
  if (issueTracker(ctx, issueKey) === undefined) return {};
  if (skip !== undefined) {
    if (skip.trim() === '') throw new TpmError('--no-issue-copy には、写しを作らずに振る訳を書いてください');
    return { issuePage: undefined, issueCopySkipped: skip };
  }
  return { issuePage: await copyIssue(ctx, issueKey, roleKey), issueCopySkipped: undefined };
}

/** 名乗らなかった訳を画面から読む。信頼のダイアログと命令の誤りは、居場所を閉じてから知らせる。 */
function notStarted(ctx: Context, record: RoleRecord, waited: number): string {
  const address = record.address ?? '';
  const screen = ctx.seats.screen(address);
  const head = `${record.title}（${address}）が ${waited} 秒たっても名乗りません。`;
  const closeSeat = (): void => {
    ctx.seats.close(address);
    delete record.address;
    writeRole(ctx, record);
  };
  if (/Adding a new directory|trust/i.test(screen)) {
    closeSeat();
    return `${head}信頼のダイアログで止まっていたので、Yes は押さずに閉じました。${record.cwd} と ${ctx.root} で 1 度 Claude Code を対話で起こして信頼するよう、Product Manager に頼んでください。`;
  }
  if (/Unknown command/i.test(screen)) {
    closeSeat();
    return `${head}最初の入力 ${ROLES[record.role].prompt} が Unknown command でした（skill セットの folder の誤り）。閉じました。`;
  }
  return `${head}居場所は残してあります。画面の終わり:\n${screen.trimEnd().split('\n').slice(-12).join('\n')}`;
}
