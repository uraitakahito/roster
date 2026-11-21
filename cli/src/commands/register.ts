// やりとりの命令を commander に載せる。
import type { Command } from 'commander';
import { createContext } from '../context.ts';
import { WAIT, type WaitKind } from '../protocol.ts';
import { TpmError } from '../skill-sets.ts';
import { INCIDENT_TYPES } from '../incidents.ts';
import { answer, askDevops, askPm, askTpm, dismiss, DONE_KINDS, doneKind, notify, reportAudit, reportDecided, reportDependabot, reportDocFix, reportDone, reportEnd, reportIncident, reportMerged, show, wait } from './messages.ts';

const collect = (value: string, all: string[]): string[] => [...all, value];

/** やりとりの命令（状態を替える `wait`・人に見せる `show`・メッセージを送る `ask`・`report`・TPM 担当の `answer`・`notify`・`dismiss`）を命令の木に足す。print は命令の出す行を書き出す。 */
export function registerMessages(program: Command, print: (lines: string[]) => void): void {
  program.command('wait <kind> <what>').description(`状態 wait を替える（kind は ${Object.keys(WAIT).join('・')}）`)
    .option('--hand', '（wait pm）Product Manager に手の操作（画面の操作・! の 1 行）を頼んだ。頼んだ手を台帳に数える', false)
    .action((kind: string, what: string, options: { hand: boolean }) => {
      if (!(kind in WAIT)) throw new TpmError(`kind は ${Object.keys(WAIT).join('・')} のどれかにしてください`);
      print(wait(createContext(), kind as WaitKind, what, options));
    });
  program.command('show <url>').description('URL を自分の居場所で開いて人に見せる').action((url: string) => print(show(createContext(), url)));

  const ask = program.command('ask').description('担当が TPM 担当に頼む');
  ask.command('tpm <text>').description('【ask-tpm】困っていること・試したこと・案とお勧め')
    .requiredOption('--waiting-for <何を>', '状態に出す、待っている物')
    .option('--reply-to <id>', '返事の先のメッセージの id')
    .action((text: string, options: { waitingFor: string, replyTo?: string }) => print(askTpm(createContext(), { text, ...options })));
  ask.command('pm').description('【ask-pm】確認のページを送る（課題に「確認」の記録も書く）')
    .requiredOption('--url <URL>', '確認のページ（tpm page put で置いた URL）')
    .requiredOption('--item <題>', '決めてほしい項目の題（繰り返せる）', collect, [] as string[])
    .requiredOption('--waiting-for <何を>', '状態に出す、待っている物')
    .action((options: { url: string, item: string[], waitingFor: string }) => print(askPm(createContext(), { url: options.url, items: options.item, waitingFor: options.waitingFor })));
  ask.command('devops').description('【ask-devops】共有の環境で DevOps Engineer 担当の手が要る')
    .requiredOption('--what <何を>').requiredOption('--why <なぜ>').option('--urgent', '急ぎ', false)
    .action((options: { what: string, why: string, urgent: boolean }) => print(askDevops(createContext(), options)));

  const report = program.command('report').description('担当が TPM 担当に知らせる');
  report.command('merged').description('【merged】自分の PR を 1 本 merge した（PR が merge 済みでなければ送らない）')
    .requiredOption('--pr <URL>').requiredOption('--note <一言>')
    .option('--unchecked <訳>', 'PR が merge 済みかを gh で確かめずに送る（gh で読めない PR。確かめた方法を書く）')
    .action((options: { pr: string, note: string, unchecked?: string }) => print(reportMerged(createContext(), options)));
  report.command('doc-fix').description('【doc-fix】文書の食い違いを直した PR を merge した')
    .requiredOption('--pr <URL>').requiredOption('--note <一言>')
    .option('--unchecked <訳>', 'PR が merge 済みかを gh で確かめずに送る（gh で読めない PR。確かめた方法を書く）')
    .action((options: { pr: string, note: string, unchecked?: string }) => print(reportDocFix(createContext(), options)));
  report.command('done').description('【done】依頼書 1 つの成果を出した')
    .option('--url <URL>', '成果のページ（tpm page put で置いた URL）')
    .option('--kind <種類>', `成果の種類（${Object.keys(DONE_KINDS).join('・')}。課題には ${Object.values(DONE_KINDS).join('・')} の記録を書く）`, 'result')
    .requiredOption('--summary <要点>')
    .option('--remaining <残り>', '依頼の外で直すとよい物・やらなかった物・merge していない PR（無ければ「なし」）')
    .option('--decisions <決めてほしいこと>', '【ask-pm】で送った項目の題（無ければ「なし」）')
    .option('--point <要点>', '課題の記録に書く要点（3 つまで・繰り返せる）', collect, [] as string[])
    .action((options: { url?: string, kind: string, summary: string, remaining?: string, decisions?: string, point: string[] }) => {
      const kind = doneKind(options.kind);
      print(reportDone(createContext(), { ...options, kind, points: options.point }));
    });
  report.command('end').description('【end】【dismiss】を受けて片付けた（課題を閉じる）')
    .option('--url <URL>', '成果のページ（tpm page put で置いた URL）')
    .option('--pr <URL>', 'merge した PR（繰り返せる）', collect, [] as string[])
    .option('--removed <worktree>', '消した worktree（繰り返せる）', collect, [] as string[])
    .option('--left <残っている物>', '残っている物（無ければ「なし」）')
    .option('--unchecked <訳>', 'PR が merge 済みかを gh で確かめずに送る（gh で読めない PR。確かめた方法を書く）')
    .action((options: { url?: string, pr: string[], removed: string[], left?: string, unchecked?: string }) => print(reportEnd(createContext(), { ...options, prs: options.pr })));
  report.command('incident <text>').description('【incident】思わぬ出来事（起きた事実）を台帳に書き、TPM 担当に知らせる')
    .requiredOption('--type <種類>', Object.keys(INCIDENT_TYPES).join('・'))
    .option('--tag <tag>', '同じ種の出来事を数える印（繰り返せる。権限で断られた命令は 権限）', collect, [] as string[])
    .option('--severe', 'すぐ止めないと害が広がる', false)
    .action((text: string, options: { type: string, tag: string[], severe: boolean }) => print(reportIncident(createContext(), { ...options, text, tags: options.tag })));
  report.command('audit').description('【audit】（Auditor）監査のページを Product Manager へじかに報告した。記録を残し、TPM 担当に写しを送る')
    .requiredOption('--url <URL>', '監査のページ（tpm page put --kind audit で置いた URL）')
    .requiredOption('--summary <要点>')
    .option('--item <題>', 'Product Manager に決めてほしい項目の題（繰り返せる）', collect, [] as string[])
    .action((options: { url: string, summary: string, item: string[] }) => print(reportAudit(createContext(), { url: options.url, summary: options.summary, items: options.item })));
  report.command('decided').description('【decided】（Auditor）Product Manager の決定を TPM 担当に渡す')
    .requiredOption('--url <URL>', '監査のページ')
    .option('--do <勧告の題>', 'する（TPM 担当が課題にして振る。繰り返せる）', collect, [] as string[])
    .option('--accept <勧告の題>', '受け入れる（直さない。繰り返せる）', collect, [] as string[])
    .option('--later <勧告の題>', '見送る（今は決めない。繰り返せる）', collect, [] as string[])
    .action((options: { url: string, do: string[], accept: string[], later: string[] }) => print(reportDecided(createContext(), { url: options.url, adopted: options.do, accepted: options.accept, later: options.later })));
  for (const [id, description] of [
    ['merge-request', '【merge-request】（Dependabot）PR の merge を頼む'],
    ['not-yet', '【not-yet】（Dependabot）まだ対象でない・rebase に応じない'],
    ['recreated', '【recreated】（Dependabot）PR が新しい番号で作り直された'],
  ] as const) {
    report.command(`${id} <text>`).description(description)
      .option('--title <題>', '（recreated）新しい番号の居場所の題')
      .action((text: string, options: { title?: string }) => print(reportDependabot(createContext(), id, { text, ...options })));
  }

  program.command('answer <key> <text>').description('TPM 担当が【answer】を返す（課題に「決定」の記録も書く）')
    .option('--reply-to <id>', '返事の先のメッセージの id')
    .action((key: string, text: string, options: { replyTo?: string }) => print(answer(createContext(), key, { text, ...options })));
  program.command('notify <key> <text>').description('TPM 担当が【notify】を送る（返事は要らない）')
    .option('--reply-to <id>', '返事の先のメッセージの id')
    .action((key: string, text: string, options: { replyTo?: string }) => print(notify(createContext(), key, { text, ...options })));
  program.command('dismiss <key>').description('TPM 担当が【dismiss】を送る')
    .option('--handover', '担当の交代のため（担当は課題を閉じない）', false)
    .option('--supersede', '済んでいない依頼書・届いていないメッセージを取り消して送る（本文に「取り消す: …」と載る）', false)
    .action((key: string, options: { handover: boolean, supersede: boolean }) => print(dismiss(createContext(), key, options)));
}
