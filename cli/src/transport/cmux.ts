// cmux の adapter。連携の口を cmux の命令に写す。cmux の言葉（workspace・surface・サイドバー）はこのファイルの外に出さない。
import type { Exec, ExecResult } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import type { Seat, SeatLabel, SpawnOptions, StatusKey, Transport } from './types.ts';

/** 状態の鍵ごとの見た目（protocol の「サイドバー」）。 */
const STATUS_STYLE: Record<StatusKey, string[]> = {
  model: ['--icon', 'sparkle', '--priority', '90'],
  wait: ['--icon', 'hourglass', '--priority', '80'],
};

/** 起動の命令の上限（バイト）。超えると cmux は黙って実行しない。 */
const COMMAND_LIMIT = 1024;

/** cmux で居場所（workspace）を作り、状態をサイドバーに出す adapter。 */
export class CmuxTransport implements Transport {
  private readonly exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  whoami(): string {
    const caller = (this.json(['identify']) as { caller?: { workspace_ref?: string } }).caller;
    if (!caller?.workspace_ref) throw new TpmError('cmux identify が自分の workspace を返しません（cmux の中で動かしてください）');
    return caller.workspace_ref;
  }

  spawn(options: SpawnOptions): string {
    if (Buffer.byteLength(options.command) > COMMAND_LIMIT) {
      throw new TpmError(`起動の命令が ${COMMAND_LIMIT} バイトを超えています（cmux は黙って実行しません）: ${options.command}`);
    }
    const description = options.description === undefined ? [] : ['--description', options.description];
    const created = this.json(['workspace', 'create', '--name', options.title, '--cwd', options.cwd, '--command', options.command, '--focus', 'false', ...description]) as { workspace_ref?: string };
    if (!created.workspace_ref) throw new TpmError('cmux workspace create が workspace を返しません');
    return created.workspace_ref;
  }

  seats(): Seat[] {
    const list = this.json(['workspace', 'list']) as { workspaces?: { ref: string, title: string }[] };
    return (list.workspaces ?? []).map(w => ({ address: w.ref, title: w.title }));
  }

  /** 居場所の UUID（cmux の通知の workspaceId）→ 宛先と題。通知の hook が、名簿の宛先と突き合わせるのに使う。 */
  seatsById(): Map<string, Seat> {
    const list = this.json(['workspace', 'list', '--id-format', 'both']) as { workspaces?: { id: string, ref: string, title: string }[] };
    return new Map((list.workspaces ?? []).map(w => [w.id, { address: w.ref, title: w.title }]));
  }

  status(address: string): Record<string, string> | undefined {
    const r = this.exec('cmux', ['sidebar-state', '--workspace', address]);
    if (r.status !== 0) return undefined;
    const status: Record<string, string> = {};
    for (const line of r.stdout.split('\n')) {
      // 状態の行は「  wait=作業中: 読む icon=hourglass priority=80」の形（頭に空白 2 つ）。
      const m = /^ {2}([a-z_]+)=(.*)$/.exec(line);
      if (m?.[1] === undefined || m[2] === undefined) continue;
      const icon = m[2].lastIndexOf(' icon=');
      status[m[1]] = icon === -1 ? m[2] : m[2].slice(0, icon);
    }
    return status;
  }

  setTitle(title: string): void {
    this.run(['workspace', 'rename', this.whoami(), '--title', title]);
  }

  relabel(address: string, label: SeatLabel): void {
    // 題は最後に替える（説明の命令が落ちたら題は前のまま。名簿の題と揃ったままにする）。
    this.workspaceAction(address, label.description === undefined ? ['clear-description'] : ['set-description', '--description', label.description]);
    this.run(['workspace', 'rename', address, '--title', label.title]);
  }

  setColor(address: string, color: string): void {
    this.workspaceAction(address, ['set-color', '--color', color]);
  }

  /** 居場所の右クリックの操作（色・説明）を、名指した居場所に打つ。 */
  private workspaceAction(address: string, action: string[]): void {
    this.run(['workspace-action', '--workspace', address, '--action', ...action]);
  }

  setStatus(key: StatusKey, text: string): void {
    this.run(['set-status', key, text, ...STATUS_STYLE[key]]);
  }

  screen(address: string): string {
    return this.exec('cmux', ['read-screen', '--workspace', address]).stdout;
  }

  show(url: string): void {
    this.run(['open', url, '--workspace', this.whoami()]);
  }

  close(address: string): void {
    // 中で Claude Code が動いているので --force が要る（無いと confirmation_required で断られる）。
    this.run(['workspace', 'close', address, '--force']);
  }

  private run(args: string[], input?: string): ExecResult {
    const r = this.exec('cmux', args, input === undefined ? {} : { input });
    if (r.status !== 0) throw new TpmError(`cmux ${args.join(' ')} が失敗しました（${r.status}）: ${(r.stderr || r.stdout).trim()}`);
    return r;
  }

  private json(args: string[]): unknown {
    const out = this.run(['--json', ...args]).stdout;
    try {
      return JSON.parse(out);
    }
    catch {
      throw new TpmError(`cmux ${args.join(' ')} の出力を JSON として読めません: ${out.trim()}`);
    }
  }
}
