// 試験用の adapter。メッセージ・居場所・状態を、状態の folder の下のファイルに書くだけ（命令は動かさない）。
// cmux 無しで決まりの 1 周を試すためと、連携の口が cmux の形に寄りすぎていないかを確かめるためにある。
import type { State } from '../state.ts';
import type { Delivery, Incoming, MessageTrace, Seat, SpawnOptions, StatusKey, Transport } from './types.ts';

interface FileSeat extends Seat {
  cwd: string
  command: string
}

/** ファイルに書いたメッセージ 1 件。 */
export interface FileMessage {
  id: string
  from: string
  text: string
  replyTo?: string
}

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
    const message: FileMessage = { id, from, text, ...(replyTo === undefined ? {} : { replyTo }) };
    this.state.append(`${DIR}/inbox/${fileName(to)}.jsonl`, message);
    return { id, delivered: this.heldFrom(to) === undefined };
  }

  /** 宛先を「手を動かしている」にする（試験用）。これより後に送った物は、release まで届かない（pending に出る）。 */
  hold(address: string): void {
    this.state.write(`${DIR}/held/${fileName(address)}.jsonc`, this.inbox(address).length);
  }

  /** hold をやめる（溜まっていた物は届いたことになる）。 */
  release(address: string): void {
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
    const from = this.heldFrom(this.self);
    return from === undefined ? [] : this.inbox(this.self).slice(from).map(m => ({ id: m.id, from: m.from, text: m.text }));
  }

  /** file の連携は時刻を持たない。 */
  history(): MessageTrace[] {
    return [];
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
