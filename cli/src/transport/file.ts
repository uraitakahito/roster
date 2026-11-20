// 試験用の adapter。知らせ・居場所・状態を、状態の folder の下のファイルに書くだけ（命令は動かさない）。
// cmux 無しで決まりの 1 周を試すためと、連携の口が cmux の形に寄りすぎていないかを確かめるためにある。
import type { State } from '../state.ts';
import type { Delivery, Seat, SpawnOptions, StatusKey, Transport } from './types.ts';

interface FileSeat extends Seat {
  cwd: string
  command: string
}

export interface FileMessage {
  id: string
  from: string
  text: string
  replyTo?: string
}

const DIR = 'file-transport';
/** 宛先（file:3 など）をファイルの名に使える字にする。 */
const fileName = (address: string): string => address.replaceAll(/[^A-Za-z0-9._-]/g, '-');

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
    return { id, delivered: true };
  }

  /** 宛先に届いた知らせ（試験が読む）。 */
  inbox(address: string): FileMessage[] {
    return this.state.lines<FileMessage>(`${DIR}/inbox/${fileName(address)}.jsonl`);
  }

  spawn(options: SpawnOptions): string {
    const n = (this.state.read<number>(`${DIR}/next.json`) ?? 1);
    this.state.write(`${DIR}/next.json`, n + 1);
    const seat: FileSeat = { address: `file:${n}`, ...options };
    this.state.write(`${DIR}/seats/${fileName(seat.address)}.json`, seat);
    return seat.address;
  }

  /** 居場所で動かすはずだった命令（試験が読む）。 */
  command(address: string): string | undefined {
    return this.state.read<FileSeat>(`${DIR}/seats/${fileName(address)}.json`)?.command;
  }

  seats(): Seat[] {
    return this.state.list(`${DIR}/seats`)
      .map(name => this.state.read<FileSeat>(`${DIR}/seats/${name}.json`))
      .filter(s => s !== undefined)
      .map(s => ({ address: s.address, title: s.title }));
  }

  status(address: string): Record<string, string> | undefined {
    return this.state.read<Record<string, string>>(`${DIR}/status/${fileName(address)}.json`);
  }

  setStatus(key: StatusKey, text: string): void {
    this.state.write(`${DIR}/status/${fileName(this.self)}.json`, { ...this.status(this.self), [key]: text });
  }

  screen(): string {
    return '';
  }

  show(url: string): void {
    this.state.append(`${DIR}/shown.jsonl`, { at: this.self, url });
  }

  close(address: string): void {
    this.state.remove(`${DIR}/seats/${fileName(address)}.json`);
    this.state.remove(`${DIR}/status/${fileName(address)}.json`);
  }
}
