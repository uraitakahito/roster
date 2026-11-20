// やりとりの命令を commander に載せる。
import type { Command } from 'commander';
import { createContext } from '../context.ts';
import { WAIT, type WaitKind } from '../protocol.ts';
import { TpmError } from '../skill-sets.ts';
import { NOTE_KINDS, type NoteKind } from '../tracker/types.ts';
import { answer, askDevops, askPm, askTpm, dismiss, notify, reportDependabot, reportDocFix, reportDone, reportEnd, reportMerged, show, wait } from './messages.ts';

const collect = (value: string, all: string[]): string[] => [...all, value];
const DONE_KINDS: NoteKind[] = ['提案', '計画', '結果'];

/** やりとりの命令（状態を替える `wait`・人に見せる `show`・知らせを送る `ask`・`report`・TPM 担当の `answer`・`notify`・`dismiss`）を命令の木に足す。print は命令の出す行を書き出す。 */
export function registerMessages(program: Command, print: (lines: string[]) => void): void {
  program.command('wait <kind> <what>').description(`状態 wait を替える（kind は ${Object.keys(WAIT).join('・')}）`)
    .action((kind: string, what: string) => {
      if (!(kind in WAIT)) throw new TpmError(`kind は ${Object.keys(WAIT).join('・')} のどれかにしてください`);
      print(wait(createContext(), kind as WaitKind, what));
    });
  program.command('show <url>').description('URL を自分の居場所で開いて人に見せる').action((url: string) => print(show(createContext(), url)));

  const ask = program.command('ask').description('担当が TPM 担当に頼む');
  ask.command('tpm <text>').description('【相談(TPM)】困っていること・試したこと・案とお勧め')
    .requiredOption('--waiting-for <何を>', '状態に出す、待っている物')
    .option('--reply-to <id>', '返事の先の知らせの id')
    .action((text: string, options: { waitingFor: string, replyTo?: string }) => print(askTpm(createContext(), { text, ...options })));
  ask.command('pm').description('【PM への依頼】確認の Artifact を送る（課題に「確認」の記録も書く）')
    .requiredOption('--url <URL>', '確認の Artifact')
    .requiredOption('--item <題>', '決めてほしい項目の題（繰り返せる）', collect, [] as string[])
    .requiredOption('--waiting-for <何を>', '状態に出す、待っている物')
    .action((options: { url: string, item: string[], waitingFor: string }) => print(askPm(createContext(), { url: options.url, items: options.item, waitingFor: options.waitingFor })));
  ask.command('devops').description('【DevOps への依頼】共有の環境で DevOps Engineer 担当の手が要る')
    .requiredOption('--what <何を>').requiredOption('--why <なぜ>').option('--urgent', '急ぎ', false)
    .action((options: { what: string, why: string, urgent: boolean }) => print(askDevops(createContext(), options)));

  const report = program.command('report').description('担当が TPM 担当に知らせる');
  report.command('merged').description('【merge 済み】自分の PR を 1 本 merge した')
    .requiredOption('--pr <URL>').requiredOption('--note <一言>')
    .action((options: { pr: string, note: string }) => print(reportMerged(createContext(), options)));
  report.command('doc-fix').description('【ドキュメント修正】文書の食い違いを直した PR を merge した')
    .requiredOption('--pr <URL>').requiredOption('--note <一言>')
    .action((options: { pr: string, note: string }) => print(reportDocFix(createContext(), options)));
  report.command('done').description('【完成】依頼書 1 つの成果を出した')
    .option('--url <URL>', '成果の Artifact')
    .option('--kind <種類>', `課題に書く記録の種類（${DONE_KINDS.join('・')}）`, '結果')
    .requiredOption('--summary <要点>')
    .option('--remaining <残り>', '依頼の外で直すとよい物・やらなかった物・merge していない PR（無ければ「なし」）')
    .option('--decisions <決めてほしいこと>', '【PM への依頼】で送った項目の題（無ければ「なし」）')
    .option('--point <要点>', '課題の記録に書く要点（3 つまで・繰り返せる）', collect, [] as string[])
    .action((options: { url?: string, kind: string, summary: string, remaining?: string, decisions?: string, point: string[] }) => {
      if (!(NOTE_KINDS as readonly string[]).includes(options.kind) || !DONE_KINDS.includes(options.kind as NoteKind)) throw new TpmError(`--kind は ${DONE_KINDS.join('・')} のどれかにしてください`);
      print(reportDone(createContext(), { ...options, kind: options.kind as NoteKind, points: options.point }));
    });
  report.command('end').description('【終わり】【dismiss】を受けて片付けた（課題を閉じる）')
    .option('--url <URL>', '成果の Artifact')
    .option('--pr <URL>', 'merge した PR（繰り返せる）', collect, [] as string[])
    .option('--removed <worktree>', '消した worktree（繰り返せる）', collect, [] as string[])
    .option('--left <残っている物>', '残っている物（無ければ「なし」）')
    .action((options: { url?: string, pr: string[], removed: string[], left?: string }) => print(reportEnd(createContext(), { ...options, prs: options.pr })));
  for (const [id, description] of [
    ['merge-request', '【merge の依頼】（Dependabot）PR の merge を頼む'],
    ['not-yet', '【まだ】（Dependabot）まだ対象でない・rebase に応じない'],
    ['recreated', '【作り直し】（Dependabot）PR が新しい番号で作り直された'],
  ] as const) {
    report.command(`${id} <text>`).description(description)
      .option('--title <題>', '（recreated）新しい番号の居場所の題')
      .action((text: string, options: { title?: string }) => print(reportDependabot(createContext(), id, { text, ...options })));
  }

  program.command('answer <key> <text>').description('TPM 担当が【answer】を返す（課題に「決定」の記録も書く）')
    .option('--reply-to <id>', '返事の先の知らせの id')
    .action((key: string, text: string, options: { replyTo?: string }) => print(answer(createContext(), key, { text, ...options })));
  program.command('notify <key> <text>').description('TPM 担当が【notify】を送る（返事は要らない）')
    .option('--reply-to <id>', '返事の先の知らせの id')
    .action((key: string, text: string, options: { replyTo?: string }) => print(notify(createContext(), key, { text, ...options })));
  program.command('dismiss <key>').description('TPM 担当が【dismiss】を送る')
    .option('--handover', '担当の交代のため（担当は課題を閉じない）', false)
    .action((key: string, options: { handover: boolean }) => print(dismiss(createContext(), key, options)));
}
