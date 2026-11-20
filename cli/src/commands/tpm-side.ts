// TPM 担当が打つ命令: 名乗る（tpmHello。tpm hello から呼ばれる）・名簿を見る（roles）・課題を担当に振る（assign）・閉じる（close）。
import { join } from 'node:path';
import { shellQuote } from '../shell.ts';
import type { Context } from '../context.ts';
import { modelStatus, ROLES, TPM_TITLE, WAIT, type RoleName } from '../protocol.ts';
import { resolveSettings } from '../settings.ts';
import { allRoles, assertKey, readRole, removeRole, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { brief } from './messages.ts';

/** 名乗ったかを見る間（ミリ秒）。 */
const HELLO_INTERVAL_MS = 2000;

/**
 * TPM 担当が名乗る（$TPM_KEY の無い tpm hello）: 居場所の題と状態を出し、自分の宛先を状態に書く。続けて名簿を出す。
 * 状態の model は、旗が無ければ起こす 1 行と同じ決め方（resolveSettings）。effort は、旗が無ければ Claude Code が入れる $CLAUDE_EFFORT（実際の effort）を旗と同じに扱う。
 */
export function tpmHello(ctx: Context, options: { model?: string, effort?: string } = {}): string[] {
  const address = ctx.transport.whoami();
  ctx.transport.setTitle(TPM_TITLE);
  const settings = resolveSettings('tpm', { flags: { model: options.model, effort: options.effort ?? ctx.env.CLAUDE_EFFORT }, env: ctx.env });
  ctx.transport.setStatus('model', modelStatus(settings.model, settings.effort));
  ctx.transport.setStatus('wait', WAIT.work('起動'));
  ctx.state.write('tpm.json', { address } satisfies TpmRecord);
  return [`TPM 担当の宛先: ${address}`, `課題管理: ${ctx.config.tracker}・連携: ${ctx.config.transport}`, ...roles(ctx)];
}

/** 名簿を、実際に動いている居場所と突き合わせて出す。 */
export function roles(ctx: Context): string[] {
  const seats = ctx.transport.seats();
  const records = allRoles(ctx);
  if (records.length === 0) return ['名簿: 担当はいない'];
  return ['名簿:', ...records.map((r) => {
    const alive = r.address !== undefined && seats.some(s => s.address === r.address);
    const wait = alive && r.address !== undefined ? ctx.transport.status(r.address)?.wait : undefined;
    const where = alive ? `${r.address}（${wait ?? '状態なし'}）` : '消えた（居場所が無い。tpm assign で起こし直すか、tpm close で名簿から消す）';
    return `- ${r.key}  ${ROLES[r.role].label}  ${where}${r.dismissed ? `  片付け済み（${r.dismissed === 'handover' ? '交代' : '終わり'}）` : ''}${r.brief ? `  依頼書: ${r.brief}` : ''}`;
  })];
}

/** `tpm assign` の旗。 */
export interface AssignOptions {
  role: RoleName
  /** 居場所の題に付ける短い題（Software Engineer 担当だけが使う）。 */
  title?: string
  brief?: string
  issue?: string
  cwd?: string
  model?: string
  effort?: string
  permissionMode?: string
  /** 【依頼】に添える一言。 */
  note?: string
  /** 名乗りを待つ秒。0 なら待たない。 */
  wait: number
}

/**
 * 課題を担当に振る。同じ鍵の担当が動いていれば、その担当に【依頼】で新しい依頼書を送る（背景を知っているため）。
 * いなければ（居場所が消えていても）起こし、名乗るまで待つ。
 */
export function assign(ctx: Context, key: string, options: AssignOptions): string[] {
  assertKey(key);
  const existing = readRole(ctx, key);
  if (existing?.address !== undefined && ctx.transport.seats().some(s => s.address === existing.address)) {
    if (options.brief === undefined) throw new TpmError(`${key} の担当はもう動いています（${existing.address}）。新しい依頼書を --brief で渡してください`);
    return brief(ctx, existing, options.brief, options.note);
  }
  if (options.issue !== undefined && !ctx.tracker.owns(options.issue)) {
    throw new TpmError(`${options.issue} は、この project の課題管理（${ctx.config.tracker}）の鍵ではありません`);
  }
  const def = ROLES[options.role];
  const settings = resolveSettings(options.role, { flags: options, config: ctx.config.roles[options.role], env: ctx.env });
  const record: RoleRecord = {
    key,
    role: options.role,
    title: def.title(key, options.title ?? '課題'),
    cwd: options.cwd ?? ctx.project,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...settings,
    ...(options.brief === undefined ? {} : { brief: options.brief }),
    ...(options.issue === undefined ? {} : { issue: options.issue }),
  };
  writeRole(ctx, record);
  const command = [join(ctx.root, 'cli', 'bin', 'tpm'), 'run-role', key, '--project', ctx.project, '--state', ctx.state.dir].map(shellQuote).join(' ');
  record.address = ctx.transport.spawn({ title: record.title, cwd: record.cwd, command });
  writeRole(ctx, record);
  const head = `${existing ? '起こし直した' : '起こした'}: ${record.title}（${record.address}・${modelStatus(record.model, record.effort)}）`;
  if (options.wait <= 0) return [head, '名乗り（tpm hello）は待っていない'];
  for (let waited = 0; waited < options.wait * 1000; waited += HELLO_INTERVAL_MS) {
    if (readRole(ctx, key)?.helloAt !== undefined) return [head, '名乗った（tpm hello が来た）'];
    ctx.sleep(HELLO_INTERVAL_MS);
  }
  if (readRole(ctx, key)?.helloAt !== undefined) return [head, '名乗った（tpm hello が来た）'];
  throw new TpmError(notStarted(ctx, record, options.wait));
}

/** 名乗らなかった訳を画面から読む。信頼のダイアログと命令の誤りは、居場所を閉じてから知らせる。 */
function notStarted(ctx: Context, record: RoleRecord, waited: number): string {
  const address = record.address ?? '';
  const screen = ctx.transport.screen(address);
  const head = `${record.title}（${address}）が ${waited} 秒たっても名乗りません。`;
  const closeSeat = (): void => {
    ctx.transport.close(address);
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

/** 担当の居場所を閉じ、名簿から消す。 */
export function close(ctx: Context, key: string): string[] {
  const record = readRole(ctx, key);
  if (record === undefined) throw new TpmError(`名簿に担当がいません: ${key}`);
  const alive = record.address !== undefined && ctx.transport.seats().some(s => s.address === record.address);
  if (alive && record.address !== undefined) ctx.transport.close(record.address);
  removeRole(ctx, key);
  return [`閉じた: ${record.title}${alive ? `（${record.address}）` : '（居場所はもう無かった）'}`];
}
