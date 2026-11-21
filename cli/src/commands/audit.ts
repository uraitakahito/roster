// tpm audit …: Auditor の席を起こす（start。Product Manager が打つ）・監査を始める（begin。Auditor が打つ）・新しい文脈になった印を書く（fresh。hook が呼ぶ）。
// Auditor は TPM 担当の回し方も見るので、席は TPM 担当の手を通さない: 起こすのも閉じるのも Product Manager で、tpm assign・dismiss・close はこの席を断る。
// 報告と決定の命令（tpm report audit・tpm report decided）は messages.ts にある。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { appendAudit, daysSince, lastReport, pendingReports, readAudits, staleReport, type AuditEvent } from '../audits.ts';
import { createContext, type Context } from '../context.ts';
import { recordGateStop } from '../evidence.ts';
import { readIncidents, requireIncident } from '../incidents.ts';
import { AUDIT_KEY, modelStatus, ROLES, WAIT } from '../protocol.ts';
import { readRole, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { resolveSettings } from '../settings.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { numberOf } from './incident.ts';
import { roleOf } from './infra.ts';
import { launch } from './tpm-side.ts';

/** core の skill セットの中の file（skill と、監査の手順・規程）。 */
const coreSkill = (ctx: Context, ...path: string[]): string => join(skillSetDir(ctx.root, 'core'), '.claude', 'skills', ...path);

/** MM-DD HH:MM（台帳の 1 行と同じ形）。 */
const stamp = (iso: string): string => iso.slice(5, 16).replace('T', ' ');

/** `tpm audit start` の旗。 */
export interface StartOptions {
  model?: string
  effort?: string
  permissionMode?: string
  /** 起こした Auditor の tpm hello を待つ秒。0 なら待たない。 */
  wait: number
}

/**
 * Auditor の席を起こす（Product Manager が自分の手で打つ）。名簿に Auditor の行を書き、居場所を作って、名乗るまで待つ。
 * 席は project に 1 つ。もうあれば断る（その席で /clear → /audit を呼ぶ）。居場所が消えていれば起こし直す。
 * 担当の居場所からは打てない。TPM 担当と担当が道具として打つのは、guard が止める。
 */
export function auditStart(ctx: Context, options: StartOptions): string[] {
  if (ctx.env.TPM_KEY) throw new TpmError('Audit の席を起こすのは Product Manager です。担当の居場所からは起こせません');
  if (!Number.isFinite(options.wait) || options.wait < 0) throw new TpmError('--wait は 0 以上の数にしてください（0 なら待たない）');
  // skill が無いまま起こすと、最初の入力が Unknown command になる。
  const skill = coreSkill(ctx, 'audit', 'SKILL.md');
  if (!existsSync(skill)) throw new TpmError(`skill /audit がまだありません（${skill}）。roster の repo を新しくしてから打ってください`);
  const existing = readRole(ctx, AUDIT_KEY);
  if (existing?.address !== undefined && ctx.transport.seats().some(s => s.address === existing.address)) {
    throw new TpmError(`Audit の席はもうあります（${existing.address}）。その席で /clear を打ってから、/audit を呼んでください`);
  }
  const record: RoleRecord = {
    key: AUDIT_KEY,
    role: 'auditor',
    title: ROLES.auditor.title(),
    cwd: ctx.project,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...resolveSettings('auditor', { flags: options, config: ctx.config.roles.auditor, env: ctx.env }),
  };
  const lines = launch(ctx, record, existing !== undefined, options.wait, ['この席で /audit（定期の監査）か /audit <件の番号…>（臨時の監査）を呼ぶ。2 度目からは、先に /clear を打つ']);
  appendAudit(ctx, { kind: 'start', address: record.address ?? '' });
  return lines;
}

/** この命令を打ってよいのは Auditor（Audit の席）だけ。 */
function requireAuditor(ctx: Context, command: string): void {
  if (roleOf(ctx.env) !== 'auditor') throw new TpmError(`${command} は Auditor（Audit の席）が打ちます`);
}

/** 監査の材料のうち、いつも同じ所にある物と、前の監査（名乗った時と、監査を始めた時に出す）。 */
function materials(ctx: Context, events: AuditEvent[]): string[] {
  const file = (label: string, path: string): string => `${label}: ${existsSync(path) ? path : `無い（${path}）`}`;
  const last = lastReport(events);
  return [
    file('監査の規程', coreSkill(ctx, '_shared', 'audit-charter.md')),
    file('監査の手順', coreSkill(ctx, '_shared', 'audit.md')),
    last === undefined ? '前の監査: まだ無い（次が最初の監査）' : `前の監査: ${last.url}（${stamp(last.at)} に報告。${daysSince(last.at, ctx.now())} 日前）`,
    ...pendingReports(events).map(r => `答えの出ていない報告: ${r.url}（${stamp(r.at)} に報告。決めてほしいこと: ${r.items.join('・') || 'なし'}）。Product Manager に聞き直す`),
  ];
}

/**
 * Auditor が名乗る（tpm hello から呼ばれる）。居場所の題と状態を出し、名簿に宛先と時刻を書き、監査の材料を返す。
 * TPM 担当が起きていなくても名乗れる（Auditor の席は TPM 担当に頼らない）。
 */
export function auditorHello(ctx: Context, record: RoleRecord): string[] {
  record.address = ctx.transport.whoami();
  record.helloAt = ctx.now().toISOString();
  // Product Manager が手で起こした居場所でも、バナーの hook が名簿と突き合わせられるように、題をここで付ける。
  ctx.transport.setTitle(record.title);
  ctx.transport.setStatus('model', modelStatus(record.model, record.effort));
  ctx.transport.setStatus('wait', WAIT.pm('/audit'));
  writeRole(ctx, record);
  return [
    `役割: ${ROLES[record.role].label}`,
    `課題の Key: ${record.key}`,
    ...materials(ctx, readAudits(ctx)),
    `TPM 担当の宛先: ${ctx.state.read<TpmRecord>('tpm.jsonc')?.address ?? '無い（TPM 担当が起きていない）'}`,
    `自分の宛先: ${record.address}`,
  ];
}

/**
 * 監査を始める（Auditor が、/audit の頭で打つ）。numbers は臨時の監査で名指された件の番号（無ければ定期）。
 * 前の報告の後に新しい文脈（席を起こした・/clear した）になっていなければ、始めずに止まる。通れば、監査の材料を返す。
 */
export function auditBegin(ctx: Context, numbers: string[]): string[] {
  requireAuditor(ctx, 'tpm audit begin');
  const events = readAudits(ctx);
  const stale = staleReport(events);
  if (stale !== undefined) {
    recordGateStop(ctx, 'stale-context', stale.url);
    throw new TpmError([
      `前の監査の報告（${stale.url}・${stamp(stale.at)}）の後に、/clear していません。監査は始めていません。`,
      '前の監査の文脈が残ったままだと、自分の前の勧告を自分で追いかけることになります。',
      'Product Manager に「/clear を打ってから、もう 1 度 /audit を呼んでください」と頼んで、ここで止まってください。',
    ].join('\n'));
  }
  const incidents = numbers.map(n => requireIncident(ctx, numberOf(n)).n);
  appendAudit(ctx, { kind: 'begin', incidents });
  const all = readIncidents(ctx);
  const open = all.filter(i => i.status === 'open');
  const last = lastReport(events);
  return [
    `監査を始めた: ${incidents.length === 0 ? '定期' : `臨時（${incidents.map(n => `#${n}`).join('・')}）`}`,
    ...materials(ctx, events),
    `台帳: 未決 ${open.length}（出来事 ${open.filter(i => i.type !== undefined).length}・残りと PM の手 ${open.filter(i => i.type === undefined).length}）・振った ${all.filter(i => i.status === 'assigned').length}`,
    `見直す: tpm incident review／追いかける: tpm incident follow${last === undefined ? '' : ` --since ${last.at}`}`,
  ];
}

/**
 * 新しい文脈になった印を書く（Auditor の席の SessionStart の hook が呼ぶ）。数えるのは、席を起こした時（startup）と /clear の時（clear）。
 * 続きから開いた時（resume）と文脈を要約した時（compact）は、前の監査が残っているので数えない。Auditor の席でなければ何もしない。
 */
export function auditFresh(ctx: Context, stdin: string): void {
  if (roleOf(ctx.env) !== 'auditor') return;
  const source = (JSON.parse(stdin) as { source?: unknown }).source;
  if (source === 'startup' || source === 'clear') appendAudit(ctx, { kind: 'fresh', source });
}

/** `tpm audit` の命令を命令の木に足す。readStdin は hook の標準入力を読む。 */
export function registerAudit(program: Command, print: (lines: string[]) => void, readStdin: () => string): void {
  const audit = program.command('audit').description('Auditor の席（Product Manager が起こす）と、監査の始まり');
  audit.command('start').description('Product Manager が Auditor の席を起こす（居場所を作り、名乗るまで待つ。席は project に 1 つ）')
    .option('--model <model>', 'Auditor の model（既定は config.jsonc の auditor の欄・$TPM_MODEL・役割の既定の順）')
    .option('--effort <effort>', 'Auditor の effort（同じ順）')
    .option('--permission-mode <mode>', 'Auditor の permission mode（同じ順）')
    .option('--wait <秒>', '起こした Auditor の tpm hello を待つ秒（0 なら待たない）', '90')
    .action((options: Omit<StartOptions, 'wait'> & { wait: string }) => print(auditStart(createContext(), { ...options, wait: Number(options.wait) })));
  audit.command('begin [numbers...]').description('Auditor が監査を始める（番号があれば、その件の臨時の監査）。前の報告の後に /clear していなければ止まる')
    .action((numbers: string[]) => print(auditBegin(createContext(), numbers)));
  audit.command('fresh').description('（Auditor の席の hook が呼ぶ）席を起こした・/clear した印を記録する')
    .action(() => {
      // hook なので、どんな誤りでも何も出さずに 0 で終わる（標準出力は、Claude Code が文脈に足してしまう）。
      try {
        auditFresh(createContext(), readStdin());
      }
      catch (e) {
        process.stderr.write(`tpm audit fresh: ${(e as Error).message}\n`);
      }
    });
}
