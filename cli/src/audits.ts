// 監査線の記録: Auditor の席と監査で起きたことを、状態の folder の audits.jsonl に 1 行 1 件で足す。
// 「前の報告の後に、新しい文脈で始めたか」の検査と、「前の監査から何日か」の 1 行と、答えの出ていない報告を、ここから読む。
// 中身には報告の要点が入るので、ほかの記録と同じく、roster を動かす機械の外には写さない。
import type { Context } from './context.ts';

/**
 * 記録の 1 行。start は席を起こした、fresh は新しい文脈になった（席を起こした・/clear した。hook が書く）、begin は監査を始めた、
 * report は Product Manager へ報告した、decided は Product Manager の決定を TPM 担当に渡した、page-deleted は Auditor の置いたページを消した。
 */
export type AuditEvent =
  | { kind: 'start', at: string, address: string }
  | { kind: 'fresh', at: string, source: string }
  | { kind: 'begin', at: string, incidents: number[] }
  | { kind: 'report', at: string, url: string, summary: string, items: string[], copied: boolean }
  | { kind: 'decided', at: string, url: string, adopted: string[], accepted: string[], later: string[] }
  | { kind: 'page-deleted', at: string, url: string, by: string, pm: string };

/** 報告の 1 行。 */
export type AuditReport = Extract<AuditEvent, { kind: 'report' }>;

/** 記録に足す物（時刻は命令が書く）。 */
export type NewAuditEvent = AuditEvent extends infer E ? E extends AuditEvent ? Omit<E, 'at'> : never : never;

/** 記録を書いた順に読む。まだ無ければ空（Auditor の席を 1 度も起こしていない project）。 */
export const readAudits = (ctx: Context): AuditEvent[] => ctx.state.lines<AuditEvent>('audits.jsonl');

/** 記録に 1 行足す。 */
export function appendAudit(ctx: Context, event: NewAuditEvent): void {
  ctx.state.append('audits.jsonl', { at: ctx.now().toISOString(), ...event });
}

/** いちばん新しい報告。まだ無ければ undefined。 */
export const lastReport = (events: AuditEvent[]): AuditReport | undefined => events.findLast(e => e.kind === 'report');

/**
 * 前の監査の文脈が残っているか: いちばん新しい報告の後に、新しい文脈（fresh）の記録が無ければ、その報告を返す。
 * 残っていれば、同じ Auditor が自分の前の勧告を自分で追いかけることになるので、監査は始めない。
 */
export function staleReport(events: AuditEvent[]): AuditReport | undefined {
  const at = events.findLastIndex(e => e.kind === 'report');
  const report = events[at];
  if (report?.kind !== 'report') return undefined;
  return events.slice(at + 1).some(e => e.kind === 'fresh') ? undefined : report;
}

/** 答えの出ていない報告: 報告した後に、同じページの決定（decided）が無い物。 */
export function pendingReports(events: AuditEvent[]): AuditReport[] {
  return events.filter((e, i): e is AuditReport => e.kind === 'report' && !events.slice(i + 1).some(d => d.kind === 'decided' && d.url === e.url));
}

/** 時刻から now までの日数（切り捨て）。 */
export const daysSince = (at: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 86_400_000));

/** 監査の目安の間隔（日）。規程の「定期の監査は週 1 回が目安」。 */
export const AUDIT_DAYS = 7;

/**
 * TPM 担当の名簿の終わりに出す「前の監査」の 1 行。Auditor の席を 1 度も起こしていない project では出さない。
 * 出すだけで、何も起こさない（監査を始めるのは、いつも Product Manager）。
 */
export function lastAuditLine(ctx: Context): string[] {
  const events = readAudits(ctx);
  if (events.length === 0) return [];
  const last = lastReport(events);
  if (last === undefined) return ['前の監査: まだ無い（目安は週 1。Product Manager が Audit の席で /audit を呼ぶ）'];
  const days = daysSince(last.at, ctx.now());
  return [`前の監査: ${last.at.slice(0, 10)}（${days} 日前。目安は週 1${days >= AUDIT_DAYS ? '。目安を過ぎているので、Product Manager に一言伝える' : ''}）`];
}
