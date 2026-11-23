// 試験用の adapter。メッセージ・居場所・状態を、状態の folder の下のファイルに書くだけ（命令は動かさない）。
// cmux 無しで決まりの 1 周を試すためと、連携の口が cmux の形に寄りすぎていないかを確かめるためにある。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { State } from '../state.ts';
import type { Delivery, Incoming, MailboxEntry, MessageTrace, Seat, SeatLabel, SpawnOptions, StatusKey, Transport } from './types.ts';

interface FileSeat extends Seat {
  cwd: string
  command: string
  description?: string
  color?: string
}

/** 居場所の見た目（題・説明・色）。試験が読む。 */
export interface SeatLook extends SeatLabel {
  color?: string
}

/** ファイルに書いたメッセージ 1 件。 */
export interface FileMessage {
  id: string
  /** 送った居場所。 */
  sender?: string
  from: string
  text: string
  replyTo?: string
}

/** 受信箱の 1 件の状態を替えた記録（試験が mark で書き、markQueuedRead が既読を書く。後の行が勝つ）。 */
export type MailMark = Pick<MailboxEntry, 'id'> & Partial<Pick<MailboxEntry, 'state' | 'deliveredVia' | 'deliveredAt'>>;

const DIR = 'file-transport';
/** 宛先（file:3 など）をファイルの名に使える字にする。 */
const fileName = (address: string): string => address.replaceAll(/[^A-Za-z0-9._-]/g, '-');

/** メッセージ・居場所・状態を、状態の folder の下のファイルに書く adapter（試験用）。 */
export class FileTransport implements Transport {
  private readonly state: State;
  private readonly self: string;

  /** self は自分の宛先。 */
  constructor(state: State, self: string) {
    this.state = state;
    this.self = self;
  }

  whoami(): string {
    return this.self;
  }

  send(to: string, from: string, text: string, replyTo?: string): Delivery {
    const id = `m${this.inbox(to).length + 1}-${fileName(to)}`;
    const message: FileMessage = { id, sender: this.self, from, text, ...(replyTo === undefined ? {} : { replyTo }) };
    this.state.append(`${DIR}/inbox/${fileName(to)}.jsonl`, message);
    return { id, delivered: this.heldFrom(to) === undefined };
  }

  /** 宛先を「手を動かしている」にする（試験用）。これより後に送った物は、release まで届かない（pending に出る）。 */
  hold(address: string): void {
    this.state.write(`${DIR}/held/${fileName(address)}.jsonc`, this.inbox(address).length);
  }

  /** hold をやめる（溜まっていた物は届いたことになる）。at は届いた時刻（試験が history に出す）。 */
  release(address: string, at?: string): void {
    const from = this.heldFrom(address);
    if (from !== undefined && at !== undefined) {
      for (const m of this.inbox(address).slice(from)) this.state.append(`${DIR}/delivered.jsonl`, { id: m.id, deliveredAt: at } satisfies MessageTrace);
    }
    this.state.remove(`${DIR}/held/${fileName(address)}.jsonc`);
  }

  private heldFrom(address: string): number | undefined {
    return this.state.read<number>(`${DIR}/held/${fileName(address)}.jsonc`);
  }

  /** 宛先に届いたメッセージ（試験が読む）。 */
  inbox(address: string): FileMessage[] {
    return this.state.lines<FileMessage>(`${DIR}/inbox/${fileName(address)}.jsonl`);
  }

  /** file の連携は送った時に届くので、hold した宛先のほかは、届いていないメッセージは無い。 */
  pending(): Incoming[] {
    return this.mailbox(this.self).filter(m => m.state === 'queued').map(m => ({ id: m.id, from: m.from, text: m.text }));
  }

  queued(to: string): string[] {
    return this.mailbox(to).filter(m => m.state === 'queued').map(m => m.id);
  }

  /** hold の後に送った物は queued、ほかは delivered。mark で替えた物は、その状態と配った道・時刻。 */
  mailbox(address: string): MailboxEntry[] {
    const from = this.heldFrom(address);
    const marks = new Map<string, MailMark>();
    for (const m of this.state.lines<MailMark>(`${DIR}/marks.jsonl`)) marks.set(m.id, { ...marks.get(m.id), ...m });
    return this.inbox(address).map((m, i) => ({
      id: m.id,
      from: m.from,
      text: m.text,
      state: from !== undefined && i >= from ? 'queued' as const : 'delivered' as const,
      ...marks.get(m.id),
    }));
  }

  /** cmux と同じく、その居場所が送ってまだ相手に届いていない物があれば、既読にしない。 */
  markQueuedRead(address: string): MailboxEntry[] {
    const dir = join(this.state.dir, DIR, 'inbox');
    const boxes = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -'.jsonl'.length)) : [];
    const sentQueued = boxes.some(box => this.mailbox(box).some(m => m.state === 'queued' && this.inbox(box).find(x => x.id === m.id)?.sender === address));
    if (sentQueued) return [];
    const queued = this.mailbox(address).filter(m => m.state === 'queued');
    for (const m of queued) this.mark(m.id, { state: 'read' });
    return queued;
  }

  /** 受信箱の 1 件の状態・配った道・時刻を替える（試験用）。 */
  mark(id: string, fields: Omit<MailMark, 'id'>): void {
    this.state.append(`${DIR}/marks.jsonl`, { id, ...fields } satisfies MailMark);
  }

  /** file の連携は時刻を持たない。release に時刻を渡した物だけ、届いた時刻を返す（試験用）。 */
  history(): MessageTrace[] {
    return this.state.lines<MessageTrace>(`${DIR}/delivered.jsonl`);
  }

  spawn(options: SpawnOptions): string {
    const n = (this.state.read<number>(`${DIR}/next.jsonc`) ?? 1);
    this.state.write(`${DIR}/next.jsonc`, n + 1);
    const seat: FileSeat = { address: `file:${n}`, ...options };
    this.state.write(`${DIR}/seats/${fileName(seat.address)}.jsonc`, seat);
    return seat.address;
  }

  /** 居場所で動かすはずだった命令（試験が読む）。 */
  command(address: string): string | undefined {
    return this.state.read<FileSeat>(`${DIR}/seats/${fileName(address)}.jsonc`)?.command;
  }

  seats(): Seat[] {
    return this.state.list(`${DIR}/seats`)
      .map(name => this.state.read<FileSeat>(`${DIR}/seats/${name}.jsonc`))
      .filter(s => s !== undefined)
      .map(s => ({ address: s.address, title: s.title }));
  }

  status(address: string): Record<string, string> | undefined {
    return this.state.read<Record<string, string>>(`${DIR}/status/${fileName(address)}.jsonc`);
  }

  setTitle(title: string): void {
    const file = `${DIR}/seats/${fileName(this.self)}.jsonc`;
    const seat = this.state.read<FileSeat>(file);
    // 起こされていない居場所（TPM 担当）は一覧に載らないので、題を覚える先が無い。
    if (seat !== undefined) this.state.write(file, { ...seat, title });
  }

  relabel(address: string, label: SeatLabel): void {
    const file = `${DIR}/seats/${fileName(address)}.jsonc`;
    const seat = this.state.read<FileSeat>(file);
    if (seat === undefined) return;
    // 説明の無い label は、前の説明を消す。
    delete seat.description;
    this.state.write(file, { ...seat, ...label });
  }

  setColor(address: string, color: string): void {
    const file = `${DIR}/seats/${fileName(address)}.jsonc`;
    const seat = this.state.read<FileSeat>(file);
    if (seat !== undefined) this.state.write(file, { ...seat, color });
  }

  /** 居場所の見た目（試験が読む）。居場所が無ければ undefined。 */
  look(address: string): SeatLook | undefined {
    const seat = this.state.read<FileSeat>(`${DIR}/seats/${fileName(address)}.jsonc`);
    if (seat === undefined) return undefined;
    const { title, description, color } = seat;
    return { title, ...(description === undefined ? {} : { description }), ...(color === undefined ? {} : { color }) };
  }

  setStatus(key: StatusKey, text: string): void {
    this.state.write(`${DIR}/status/${fileName(this.self)}.jsonc`, { ...this.status(this.self), [key]: text });
  }

  screen(): string {
    return '';
  }

  show(url: string): void {
    this.state.append(`${DIR}/shown.jsonl`, { at: this.self, url });
  }

  close(address: string): void {
    this.state.remove(`${DIR}/seats/${fileName(address)}.jsonc`);
    this.state.remove(`${DIR}/status/${fileName(address)}.jsonc`);
  }
}
