// cmux の adapter。連携の口を cmux の命令に写す。cmux の言葉（workspace・surface・サイドバー）はこのファイルの外に出さない。
import type { Exec, ExecResult } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import type { Delivery, Seat, SpawnOptions, StatusKey, Transport } from './types.ts';

/** 状態の鍵ごとの見た目（protocol の「サイドバー」）。 */
const STATUS_STYLE: Record<StatusKey, string[]> = {
  model: ['--icon', 'sparkle', '--priority', '90'],
  wait: ['--icon', 'hourglass', '--priority', '80'],
};

/** 届いたかを見る回数と間（ミリ秒）。相手が手を動かしている間は queued のままなので、長くは待たない。 */
const DELIVERY_TRIES = 4;
const DELIVERY_INTERVAL_MS = 500;

/** 起動の命令の上限（バイト）。超えると cmux は黙って実行しない。 */
const COMMAND_LIMIT = 1024;

export type Sleep = (ms: number) => void;

const sleepSync: Sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export class CmuxTransport implements Transport {
  private readonly exec: Exec;
  private readonly sleep: Sleep;

  constructor(exec: Exec, sleep: Sleep = sleepSync) {
    this.exec = exec;
    this.sleep = sleep;
  }

  whoami(): string {
    const caller = (this.json(['identify']) as { caller?: { workspace_ref?: string } }).caller;
    if (!caller?.workspace_ref) throw new TpmError('cmux identify が自分の workspace を返しません（cmux の中で動かしてください）');
    return caller.workspace_ref;
  }

  send(to: string, from: string, text: string, replyTo?: string): Delivery {
    // 本文は標準入力で渡す（- で始まる本文や長い本文でも引数の読み違いが起きない）。
    const target = replyTo === undefined ? [to] : ['--reply-to', replyTo];
    const out = this.run(['agent', 'message', ...target, '--from', from, '-'], text).stdout;
    const id = /message ([0-9a-f-]{36})/i.exec(out)?.[1];
    if (id === undefined) throw new TpmError(`cmux agent message の出力から知らせの id を読めません: ${out.trim()}`);
    for (let i = 0; i < DELIVERY_TRIES; i++) {
      if (this.delivered(to, id)) return { id, delivered: true };
      this.sleep(DELIVERY_INTERVAL_MS);
    }
    return { id, delivered: false };
  }

  private delivered(to: string, id: string): boolean {
    const inbox = this.json(['agent', 'inbox', '--surface', to, '--limit', '20']) as { messages?: { id: string, state: string }[] };
    const state = inbox.messages?.find(m => m.id === id)?.state;
    return state === 'delivered' || state === 'read';
  }

  spawn(options: SpawnOptions): string {
    if (Buffer.byteLength(options.command) > COMMAND_LIMIT) {
      throw new TpmError(`起動の命令が ${COMMAND_LIMIT} バイトを超えています（cmux は黙って実行しません）: ${options.command}`);
    }
    const created = this.json(['workspace', 'create', '--name', options.title, '--cwd', options.cwd, '--command', options.command, '--focus', 'false']) as { workspace_ref?: string };
    if (!created.workspace_ref) throw new TpmError('cmux workspace create が workspace を返しません');
    return created.workspace_ref;
  }

  seats(): Seat[] {
    const list = this.json(['workspace', 'list']) as { workspaces?: { ref: string, title: string }[] };
    return (list.workspaces ?? []).map(w => ({ address: w.ref, title: w.title }));
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
