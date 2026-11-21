// 決まりの命令の試験の足場: file の連携を使う project と、TPM 担当・担当それぞれの周りを作る。
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PAGES_URL, type PageRecord } from '../src/commands/page.ts';
import { createContext, type Context } from '../src/context.ts';
import type { Exec, ExecOptions, ExecResult } from '../src/exec.ts';
import { FileTransport } from '../src/transport/file.ts';

/** 課題の概要の節（40 字以上）のある依頼書。world が置き場に置く。 */
export const BRIEF_HTML = '<h1>依頼書</h1><section id="summary"><h2>課題の概要</h2><p>試しの課題。担当が課題の中身を読めるようにし、TPM 担当が相談に乗れるようにすることが求められている。</p></section>';
/** world が置き場に置く、概要の節のある依頼書の URL（どの world でも同じ）。 */
export const BRIEF = `${DEFAULT_PAGES_URL}/brief-1.html`;

export interface Call {
  cmd: string
  args: string[]
  options?: ExecOptions
}

/**
 * 偽の置き場: tpm が打つ curl を受け、本物（pagestore）と同じ決まりで答える。
 * 番号は種類ごとに今の最大＋1、名指した番号が使われていれば 409。本物との揃いは、CI のつなぎの段が見る。
 */
export class FakeStore {
  /** 置かれたページ（置き場の中の path → 記録と本文）。 */
  pages = new Map<string, { record: PageRecord, body: Buffer }>();
  /** true の間、つながらない（curl の exit 7）。 */
  down = false;
  /** 置く要求の答えを替える（置き場が断る時の試験）。 */
  refuse: { code: number, body: string } | undefined;

  /** curl の引数を読んで答える。答えの形は `<本文>\n<HTTP の code>`（-o があれば本文は file に書く）。 */
  curl(args: string[], options?: ExecOptions): ExecResult {
    if (this.down) return { status: 7, stdout: '\n000', stderr: 'curl: (7) Failed to connect' };
    const url = new URL(args.at(-1) ?? '');
    const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : undefined;
    const reply = (code: number, body: Buffer | string): ExecResult => {
      if (out !== undefined) writeFileSync(out, body);
      return { status: 0, stdout: `${out === undefined ? body.toString() : ''}\n${code}`, stderr: '' };
    };
    const q = url.searchParams;
    if (args.includes('POST')) {
      if (this.refuse !== undefined) return reply(this.refuse.code, this.refuse.body);
      const data = args[args.indexOf('--data-binary') + 1] ?? '';
      const body = data === '@-' ? Buffer.from(options?.input ?? '') : readFileSync(data.slice(1));
      const [project, key, kind] = [q.get('project') ?? '', q.get('key') ?? '', q.get('kind') ?? ''];
      const taken = [...this.pages.values()].map(p => p.record).filter(r => r.project === project && r.key === key && r.kind === kind).map(r => r.n);
      const n = Number(q.get('n') ?? Math.max(0, ...taken) + 1);
      if (taken.includes(n)) return reply(409, '{"error":"その番号は、もう使われている"}');
      const record: PageRecord = {
        project,
        key,
        kind,
        n,
        title: /<title>(.*?)<\/title>/.exec(body.toString())?.[1] ?? '',
        role: q.get('role') ?? '',
        workspace: q.get('workspace') ?? '',
        created_at: q.get('created_at') ?? `2026-11-20T12:00:${String(this.pages.size).padStart(2, '0')}.000Z`,
        size: body.length,
        path: `/${project}/${key}/${kind}-${n}.html`,
      };
      this.pages.set(record.path, { record, body });
      return reply(201, JSON.stringify({ ...record, url: `${url.origin}${record.path}` }));
    }
    if (url.pathname === '/api/pages') {
      const found = [...this.pages.values()].map(p => p.record)
        .filter(r => (['project', 'key', 'kind', 'role', 'workspace'] as const).every(f => !q.has(f) || q.get(f) === r[f]))
        .filter(r => !q.has('q') || r.title.includes(q.get('q') ?? ''))
        .sort((a, b) => (q.get('sort') === 'created_at' ? 1 : -1) * a.created_at.localeCompare(b.created_at))
        .slice(0, Number(q.get('limit') ?? 100));
      return reply(200, JSON.stringify({ pages: found }));
    }
    const page = this.pages.get(decodeURIComponent(url.pathname));
    return page === undefined ? reply(404, '{"error":"そのページは無い"}') : reply(200, page.body);
  }
}

export interface World {
  project: string
  /** 外の命令（acli・gh）が打たれた記録。 */
  calls: Call[]
  /** TPM 担当の周り。 */
  tpm: Context
  /** 鍵 key の担当の周り（address は居場所の宛先）。 */
  role: (key: string, address: string) => Context
  /** file の連携（届いたメッセージ・起こす命令を読む）。 */
  wire: FileTransport
  /** 偽の置き場（tpm page put・path・list・import と、tpm assign の課題の写しが使う）。 */
  store: FakeStore
  /** sleep で待った回数。 */
  slept: () => number
}

/** config は .claude/roles/config.jsonc に書く中身（transport は file に固定する）。env は TPM 担当の周りの環境変数に足す物。 */
export function world(config: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-world-')));
  const project = join(base, 'project');
  mkdirSync(join(project, '.claude', 'roles'), { recursive: true });
  writeFileSync(join(project, '.claude', 'roles', 'config.jsonc'), JSON.stringify({ ...config, transport: 'file' }));
  mkdirSync(join(base, 'pages'));
  writeFileSync(join(base, 'pages', 'brief-1.html'), BRIEF_HTML);
  const calls: Call[] = [];
  const store = new FakeStore();
  const exec: Exec = (cmd, args, options) => {
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    // curl は置き場への要求（tpm page …・tpm assign の課題の写し）。偽の置き場が答える。
    return cmd === 'curl' ? store.curl(args, options) : { status: 0, stdout: '{}', stderr: '' };
  };
  let slept = 0;
  const at = (env: NodeJS.ProcessEnv): Context => ({
    // 控えの folder も一時の folder にする（本物の控えに試験のページを置かない）。
    ...createContext({ XDG_STATE_HOME: join(base, 'state'), TPM_PAGES_DIR: join(base, 'pages'), ...env }, project, exec),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    sleep: () => {
      slept += 1;
    },
  });
  const tpm = at(env);
  return {
    project,
    calls,
    store,
    tpm,
    role: (key, address) => at({ TPM_PROJECT: project, TPM_KEY: key, TPM_ADDRESS: address }),
    wire: new FileTransport(tpm.state, 'file:tpm'),
    slept: () => slept,
  };
}
