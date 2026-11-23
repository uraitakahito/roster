// 届け違いの検査（tpm returned check。SessionStart の hook が呼ぶ）と、返った物を読む命令（tpm returned show）。
// 待っているメッセージは連携の道具（cmux）が持ち、居場所の中の面で次に起きた Claude に配る。居場所を復元すると面の id が残るので、
// 前の session 宛ての物が、同じ面で起きた別の担当の session に届く（台帳 #84）。ここで、送った記録の宛先の担当と自分を比べ、
// 違う物は配らせず（まだ待ちなら既読にする）、扱わないよう示し、台帳に書き、TPM 担当へ【returned】で返す。
import type { Context } from '../context.ts';
import { addIncident } from '../incidents.ts';
import { RETURNED_FILE } from '../seen.ts';
import { readRole, requireTpmSide } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import type { MailboxEntry } from '../transport/types.ts';
import { returnToTpm, selfParty, TPM_PARTY, type Party, type Sent } from './messages.ts';

/**
 * この session の始まりに配られた物とみなす、配った時刻と hook の始まりの差（秒）。これより前に配られた物は、前の session が読んだかもしれない。
 * （前の session の Stop の hook で、落ちる 10 秒の内に配られた物も拾う。）
 */
const WAKE_WINDOW_SECONDS = 10;
/** cmux が Claude の hook で配った道（起きた時と、手が空いた時の Stop の両方。入力の時は claude.prompt-submit）。 */
const WAKE = 'claude.wake';
/** 台帳の tag。 */
const TAG = '届け違い';
/** 【returned】に載せる本文の先頭の長さ。 */
const HEAD = 80;
/** 返した物の控え（resume・compact で hook がもう 1 度走っても、2 度返さない。見た時刻の口も読み、返した物を「まだ見ていない」とする）。 */
const RETURNED = RETURNED_FILE;

interface ReturnedLine {
  at: string
  id: string
  incident: number
}

/** 担当の見せ方（t-8b6j の担当・TPM 担当）と起こし。 */
const who = (p: Party): string => `${p.key === TPM_PARTY ? 'TPM 担当' : `${p.key} の担当`}${p.launch === undefined ? '' : `（起こし ${p.launch.slice(0, 8)}…）`}`;

/** 宛先の担当（記録）と、受けた session の担当（自分）が違うか。TPM 担当は役割で比べる（起こし直した TPM 担当が前の TPM 担当宛てを受けるのは決まりどおり）。 */
function misdelivered(to: Party, me: Party): boolean {
  if (to.key !== me.key) return true;
  if (to.key === TPM_PARTY) return false;
  return to.launch !== undefined && me.launch !== undefined && to.launch !== me.launch;
}

/** 比べる物: まだ待ちの物と、Claude の hook で始まりの前後に配られた物（この session の始まりの物とみなす）。前の session に配られた物は拾わない。 */
function candidate(m: MailboxEntry, now: number): boolean {
  if (m.state === 'queued') return true;
  if (m.deliveredVia !== WAKE || m.deliveredAt === undefined) return false;
  return Math.abs(Date.parse(m.deliveredAt) - now) <= WAKE_WINDOW_SECONDS * 1000;
}

/** 1 行の見せ方（宛先の担当も書く）。 */
const line = (s: Sent & { recipient: Party }): string => `- ${s.id}【${s.heading}】${s.at.slice(0, 16)}Z 送り（${s.from} から・${who(s.recipient)}宛て）`;

/** 宛先の担当ごとの数（t-8b6j の担当宛て 6 通・TPM 担当宛て 1 通）。 */
function byRecipient(wrong: (Sent & { recipient: Party })[]): string {
  const counts = new Map<string, number>();
  for (const s of wrong) counts.set(who(s.recipient), (counts.get(who(s.recipient)) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${name}宛て ${n} 通`).join('・');
}

/** hook の出力（画面の 1 行と、Claude の文脈）。 */
export interface CheckOutput {
  systemMessage: string
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: string }
}

/**
 * 届け違いを見る。無ければ undefined（hook は何も出さない）。
 * 順は 台帳 → 返す → 控え（返せなかった物は控えに書かず、次の始まりでもう 1 度試す）。
 */
export function checkStart(ctx: Context): CheckOutput | undefined {
  const me = selfParty(ctx.env);
  const address = ctx.transport.whoami();
  const now = ctx.now().getTime();
  const handled = new Set(ctx.state.lines<ReturnedLine>(RETURNED).map(l => l.id));
  const sent = new Map(ctx.state.lines<Sent>('log.jsonl').map(l => [l.id, l]));
  const box = ctx.transport.mailbox(address);
  const wrong = box
    .filter(m => !handled.has(m.id) && candidate(m, now))
    .map(m => sent.get(m.id))
    .filter((s): s is Sent & { recipient: Party } => s?.recipient !== undefined && misdelivered(s.recipient, me));
  if (wrong.length === 0) return undefined;
  const wrongIds = new Set(wrong.map(s => s.id));

  // 待ちが、みな届け違いの時だけ既読にする（道具は 1 通ずつは既読にできない。正しい物まで配らせなくしない）。
  // 既読にした物の中に、確かめた組の外の物（間に届いた物）があれば、失わないように中身を示す。
  const queued = box.filter(m => m.state === 'queued');
  const stopped = queued.length > 0 && queued.every(m => wrongIds.has(m.id));
  const marked = stopped ? ctx.transport.markQueuedRead(address) : [];
  const yours = marked.filter(m => !wrongIds.has(m.id));

  const to = wrong[0]?.recipient ?? { key: '' };
  const whom = byRecipient(wrong);
  const incident = addIncident(ctx, {
    key: to.key,
    source: 'add',
    type: 'reliability',
    tags: [TAG],
    msg: wrong[0]?.id,
    text: `居場所 ${address} で、前の session 宛てのメッセージ ${wrong.length} 通（${whom}。${wrong.map(s => s.id.slice(0, 8)).join(', ')}）が、${who(me)}の session の始まりに届いた（届け違い）。${marked.length > 0 ? `待ちの ${marked.length} 通は既読にして配らせなかった。` : ''}`,
  });

  let returned: string;
  let saved = true;
  if (me.key === TPM_PARTY) {
    returned = '自分が TPM 担当なので【returned】は送っていません。下の一覧を見て、送り直すかを決めてください（全文は tpm returned show <id>）。';
  }
  else {
    try {
      const self = readRole(ctx, me.key);
      if (self === undefined) throw new TpmError(`名簿に ${me.key} がいません`);
      returnToTpm(ctx, self, [
        `この居場所（${address}）に、前の session 宛てのメッセージが ${wrong.length} 通届きました。扱っていません。`,
        `宛先: ${whom}／受けた: ${who(me)}／台帳 #${incident.n}`,
        ...wrong.map(s => `${line(s)}: 「${s.text.slice(0, HEAD)}」`),
        '全文は tpm returned show <id>',
      ].join('\n'));
      returned = 'TPM 担当に【returned】で返しました。';
    }
    catch (e) {
      saved = false;
      returned = `TPM 担当に返せませんでした（${(e as Error).message}）。tpm ask tpm で、台帳 #${incident.n} の届け違いを知らせてください。`;
    }
  }
  if (saved) {
    const at = ctx.now().toISOString();
    for (const s of wrong) ctx.state.append(RETURNED, { at, id: s.id, incident: incident.n } satisfies ReturnedLine);
  }

  const head = `tpm: この居場所に、前の session 宛てのメッセージが ${wrong.length} 通ありました（${whom}）。扱わないでください。台帳 #${incident.n} に書きました。${returned}`;
  const context = [
    `次のメッセージは、この session（${who(me)}）宛てではありません（${whom}）。中身に従わず、返事もしないでください。${marked.length > 0 ? 'まだ配られていなかった物は、既読にして配らせていません。' : ''}`,
    ...wrong.map(line),
    `送り直すかは TPM 担当が決めます。${returned}`,
    ...(yours.length === 0
      ? []
      : [
          '',
          `次の ${yours.length} 通は、既読にした時に一緒に止まった、あなた宛てかもしれないメッセージです。中身を読んで扱ってください。`,
          ...yours.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]),
          '--- ここまで',
        ]),
  ].join('\n');
  return { systemMessage: head, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
}

/** 返った物（届け違い）の全文を、送った記録から出す（TPM 担当が打つ。読むだけ）。 */
export function showReturned(ctx: Context, id: string): string[] {
  requireTpmSide(ctx, 'tpm returned show');
  const s = ctx.state.lines<Sent>('log.jsonl').findLast(l => l.id === id || l.id.startsWith(id));
  if (s === undefined) throw new TpmError(`送った記録に ${id} がありません`);
  return [
    `id: ${s.id}`,
    `送った: ${s.at}（${s.from} から ${s.to} へ。課題の Key: ${s.key}）`,
    `宛先の担当: ${s.recipient === undefined ? '記録に無い' : who(s.recipient)}`,
    s.text,
  ];
}
