// 試験用の adapter。居場所・状態を、状態の folder の下のファイルに書くだけ（命令は動かさない）。
// cmux 無しで決まりの 1 周を試すためと、連携の口が cmux の形に寄りすぎていないかを確かめるためにある。
import type { State } from '../state.ts';
import type { Seat, SeatLabel, SpawnOptions, StatusKey, Transport } from './types.ts';

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

const DIR = 'file-transport';
/** 宛先（file:3 など）をファイルの名に使える字にする。 */
const fileName = (address: string): string => address.replaceAll(/[^A-Za-z0-9._-]/g, '-');

/** 居場所・状態を、状態の folder の下のファイルに書く adapter（試験用）。 */
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
