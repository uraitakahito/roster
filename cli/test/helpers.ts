// 決まりの命令の試験の足場: file の連携を使う project と、TPM 担当・担当それぞれの周りを作る。
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_TYPES, type FileRecord } from '../src/commands/file.ts';
import type { PageRecord } from '../src/commands/page.ts';
import { DEFAULT_PAGES_URL } from '../src/commands/store.ts';
import { createContext, type Context } from '../src/context.ts';
import { exec as realExec, type Exec, type ExecOptions, type ExecResult } from '../src/exec.ts';
import { reportDone } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
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
 * 偽の置き場: tpm が打つ curl を受け、本物（pagetray）と同じ決まりで答える。
 * 番号は種類ごとに今の最大＋1（消した番号も数える）、名指した番号が使われているか消した番号なら 409。消した URL は 410。本物との揃いは、CI のつなぎの段が見る。
 * file（/api/files）も同じ決まり。番号は名と拡張子ごと。
 */
export class FakeStore {
  /** 置かれたページ（置き場の中の path → 記録と本文）。 */
  pages = new Map<string, { record: PageRecord, body: Buffer }>();
  /** 消したページの path（番号は 2 度使わず、URL は 410）。 */
  removed = new Set<string>();
  /** true の間、つながらない（curl の exit 7）。 */
  down = false;
  /** 答えに付ける API の版（header `Pagetray-Api`）。undefined は、API の版ができる前の置き場（header が無い）。 */
  api: string | undefined = '1';
  /** 置く要求の答えを替える（置き場が断る時の試験）。 */
  refuse: { code: number, body: string } | undefined;
  /** 置かれた file（置き場の中の path → 記録と中身）。 */
  files = new Map<string, { record: FileRecord, body: Buffer }>();
  /** 消した file の path。 */
  removedFiles = new Set<string>();
  /** true の間、file のエンドポイントが無い（0.4.0 より前の置き場。404 を返す）。 */
  noFiles = false;
  /** true の間、返事の状態を持てない（0.5.0 より前の置き場。書く道は 405 を返し、一覧は reply の絞りを読まずにみな返す）。 */
  noReply = false;
  /** 置く要求（ページと file の POST）の引数。送った順。 */
  posts: URLSearchParams[] = [];
  /**
   * 送り手（actor_issuer・actor_ref）を書いた置く要求に、castlist が何と答えたことにするか（pagetray 0.6.0 の「送り手」）。
   * known は登録のあるアクター（置く）、unregistered は登録が無い（422）、unreachable は castlist に聞けない（503）。どちらも何も置かない。
   */
  sender: 'known' | 'unregistered' | 'unreachable' = 'known';

  /** 返事の状態を書いた回数（時刻をずらすため）。 */
  private replies = 0;

  /** 置く要求の送り手を見る。置いてよければ undefined、断るなら答えの code と本文。片方だけ書いた時は 400（castlist には聞かない）。 */
  private senderRefusal(q: URLSearchParams): { code: number, body: string } | undefined {
    if (q.has('actor_issuer') !== q.has('actor_ref')) return { code: 400, body: '{"error":"actor_issuer と actor_ref は両方書くか、両方書かない"}' };
    if (!q.has('actor_ref') || this.sender === 'known') return undefined;
    return this.sender === 'unregistered'
      ? { code: 422, body: '{"error":"castlist に登録の無い送り手"}' }
      : { code: 503, body: '{"error":"castlist に送り手を聞けない"}' };
  }

  /** curl の引数を読んで答える。答えの形は `<本文>\n<HTTP の code>`（-o があれば本文は file に書く）。 */
  curl(args: string[], options?: ExecOptions): ExecResult {
    if (this.down) return { status: 7, stdout: '\n000', stderr: 'curl: (7) Failed to connect' };
    const url = new URL(args.at(-1) ?? '');
    const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : undefined;
    const reply = (code: number, body: Buffer | string): ExecResult => {
      if (out !== undefined) writeFileSync(out, body);
      return { status: 0, stdout: `${out === undefined ? body.toString() : ''}\n${code} ${this.api ?? ''}`, stderr: '' };
    };
    const q = url.searchParams;
    if (url.pathname === '/api/files' || url.pathname.split('/')[3] === 'files') {
      if (this.noFiles) return reply(404, '');
      return this.file(args, url, reply);
    }
    if (url.pathname === '/api/pages/reply') {
      if (this.noReply || !args.includes('POST')) return reply(405, '');
      const page = this.pages.get(`/${q.get('project')}/${q.get('key')}/${q.get('kind')}-${q.get('n')}.html`);
      if (page === undefined) return reply(404, '{"error":"そのページは無い"}');
      const now = `2026-11-20T13:00:${String(this.replies += 1).padStart(2, '0')}.000Z`;
      const r = page.record;
      if (q.get('state') === 'waiting') {
        if (r.asked_at === undefined || r.answered_at !== undefined) r.asked_at = now;
        delete r.answered_at;
      }
      else if (q.get('state') === 'answered') {
        r.asked_at ??= now;
        r.answered_at ??= now;
      }
      else {
        return reply(400, '{"error":"state は waiting か answered"}');
      }
      return reply(200, JSON.stringify(r));
    }
    if (args.includes('DELETE')) {
      const gone = [...this.pages.values()].map(p => p.record)
        .filter(r => r.project === q.get('project') && (['key', 'kind', 'n'] as const).every(f => !q.has(f) || q.get(f) === String(r[f])))
        .map(r => r.path);
      for (const path of gone) {
        this.pages.delete(path);
        this.removed.add(path);
      }
      return reply(200, JSON.stringify({ removed: gone }));
    }
    if (args.includes('POST')) {
      this.posts.push(q);
      if (this.refuse !== undefined) return reply(this.refuse.code, this.refuse.body);
      const refusal = this.senderRefusal(q);
      if (refusal !== undefined) return reply(refusal.code, refusal.body);
      const data = args[args.indexOf('--data-binary') + 1] ?? '';
      const body = data === '@-' ? Buffer.from(options?.input ?? '') : readFileSync(data.slice(1));
      const [project, key, kind] = [q.get('project') ?? '', q.get('key') ?? '', q.get('kind') ?? ''];
      const prefix = `/${project}/${key}/${kind}-`;
      const taken = [...this.pages.keys(), ...this.removed].filter(p => p.startsWith(prefix) && /^\d+\.html$/.test(p.slice(prefix.length))).map(p => Number.parseInt(p.slice(prefix.length), 10));
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
        .filter(r => this.noReply || !q.has('reply') || (q.get('reply') === 'answered' ? r.answered_at !== undefined : r.asked_at !== undefined && r.answered_at === undefined))
        .sort((a, b) => (q.get('sort') === 'created_at' ? 1 : -1) * a.created_at.localeCompare(b.created_at))
        .slice(0, Number(q.get('limit') ?? 100));
      return reply(200, JSON.stringify({ pages: found }));
    }
    const page = this.pages.get(decodeURIComponent(url.pathname));
    if (this.removed.has(decodeURIComponent(url.pathname))) return reply(410, '{"error":"そのページは消した（2026-11-21T00:00:00.000Z）"}');
    return page === undefined ? reply(404, '{"error":"そのページは無い"}') : reply(200, page.body);
  }

  /** file のエンドポイントと中身。 */
  private file(args: string[], url: URL, reply: (code: number, body: Buffer | string) => ExecResult): ExecResult {
    const q = url.searchParams;
    const all = [...this.files.values()].map(f => f.record);
    if (url.pathname !== '/api/files') {
      const path = decodeURIComponent(url.pathname);
      if (this.removedFiles.has(path)) return reply(410, '{"error":"その file は消した"}');
      const file = this.files.get(path);
      return file === undefined ? reply(404, '{"error":"その file は無い"}') : reply(200, file.body);
    }
    if (args.includes('DELETE')) {
      const gone = all.filter(r => r.project === q.get('project') && (!q.has('key') || q.get('key') === r.key)
        && (!q.has('name') || q.get('name') === `${r.name}.${r.ext}`) && (!q.has('n') || q.get('n') === String(r.n))).map(r => r.path);
      for (const path of gone) {
        this.files.delete(path);
        this.removedFiles.add(path);
      }
      return reply(200, JSON.stringify({ removed: gone }));
    }
    if (args.includes('POST')) {
      this.posts.push(q);
      if (this.refuse !== undefined) return reply(this.refuse.code, this.refuse.body);
      const body = readFileSync((args[args.indexOf('--data-binary') + 1] ?? '').slice(1));
      const [project, key, name] = [q.get('project') ?? '', q.get('key') ?? '', q.get('name') ?? ''];
      const [stem = '', ext = ''] = name.split('.');
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stem) || body.length === 0) return reply(400, '{"error":"引数が決まりに合わない"}');
      const type = args.find(a => a.startsWith('Content-Type: '))?.slice('Content-Type: '.length) ?? '';
      if (!Object.hasOwn(FILE_TYPES, ext) || type.split(';')[0] !== FILE_TYPES[ext]?.split(';')[0]) return reply(415, '{"error":"受けない種類"}');
      // castlist には、ほかの決まり（400・415）を見終えてから聞く。
      const refusal = this.senderRefusal(q);
      if (refusal !== undefined) return reply(refusal.code, refusal.body);
      const prefix = `/${project}/${key}/files/${stem}-`;
      const taken = [...this.files.keys(), ...this.removedFiles].filter(p => p.startsWith(prefix) && p.endsWith(`.${ext}`) && /^\d+$/.test(p.slice(prefix.length, -ext.length - 1)))
        .map(p => Number.parseInt(p.slice(prefix.length), 10));
      const n = Number(q.get('n') ?? Math.max(0, ...taken) + 1);
      if (taken.includes(n)) return reply(409, '{"error":"その番号は、もう使われている"}');
      const record: FileRecord = {
        project,
        key,
        name: stem,
        ext,
        n,
        type: FILE_TYPES[ext] ?? '',
        size: body.length,
        sha256: '0'.repeat(64),
        role: q.get('role') ?? '',
        workspace: q.get('workspace') ?? '',
        created_at: q.get('created_at') ?? `2026-11-20T13:00:${String(this.files.size).padStart(2, '0')}.000Z`,
        path: `/${project}/${key}/files/${stem}-${n}.${ext}`,
      };
      this.files.set(record.path, { record, body });
      return reply(201, JSON.stringify({ ...record, url: `${url.origin}${record.path}` }));
    }
    const found = all
      .filter(r => (['project', 'key', 'role', 'workspace'] as const).every(f => !q.has(f) || q.get(f) === r[f]))
      .filter(r => !q.has('q') || `${r.name}.${r.ext}`.includes(q.get('q') ?? ''))
      .sort((a, b) => (q.get('sort') === 'created_at' ? 1 : -1) * a.created_at.localeCompare(b.created_at))
      .slice(0, Number(q.get('limit') ?? 100));
    return reply(200, JSON.stringify({ files: found }));
  }
}

export interface World {
  project: string
  /** 外の命令（acli・gh）が打たれた記録。 */
  calls: Call[]
  /** TPM 担当の周り。 */
  tpm: Context
  /** key の担当の周り（address は居場所の宛先）。 */
  role: (key: string, address: string) => Context
  /** file の連携（届いたメッセージ・起こす命令を読む）。 */
  wire: FileTransport
  /** 偽の置き場（tpm page …・tpm file … と、tpm assign の課題の写しが使う）。 */
  store: FakeStore
  /** sleep で待った回数。 */
  slept: () => number
  /** PR の URL → `gh pr view` が返す state（無い URL は MERGED）。値が undefined の URL は、gh が読めない（exit 1）。 */
  prs: Map<string, string | undefined>
  /** castlist の URL（設定の castlist と $TPM_CASTLIST_URL）。この URL への curl は、偽の置き場でなく本当の curl で送る（試験の偽の castlist が受ける）。 */
  castlist: string[]
  /** 外の命令の答えを替える（`<命令> <引数…>` の字 → 答え）。無い命令は今までどおり exit 0・`{}`。 */
  answers: Map<string, ExecResult>
}

/**
 * config は .claude/roles/config.jsonc に書く中身（transport は file に固定する）。env は TPM 担当の周りの環境変数に足す物。
 * folders は、project の直下の folder の名前 → その folder の設定の中身（上の folder から、下のいくつもの repo を触る形）。
 */
export function world(config: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}, folders: Record<string, Record<string, unknown>> = {}): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-world-')));
  const project = join(base, 'project');
  const put = (dir: string, body: Record<string, unknown>): void => {
    mkdirSync(join(dir, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'roles', 'config.jsonc'), JSON.stringify(body));
  };
  put(project, { ...config, transport: 'file' });
  for (const [name, body] of Object.entries(folders)) put(join(project, name), body);
  mkdirSync(join(base, 'pages'));
  writeFileSync(join(base, 'pages', 'brief-1.html'), BRIEF_HTML);
  const calls: Call[] = [];
  const store = new FakeStore();
  const prs = new Map<string, string | undefined>();
  const castlist = [config.castlist, env.TPM_CASTLIST_URL].filter((u): u is string => typeof u === 'string' && u !== '');
  const answers = new Map<string, ExecResult>();
  const exec: Exec = (cmd, args, options) => {
    // castlist への curl は、試験が起こした偽の castlist（か、何も待っていない port）へ本当に送る。calls には数えない。
    if (cmd === 'curl' && castlist.some(u => (args.at(-1) ?? '').startsWith(u))) return realExec(cmd, args, options);
    // gh pr view は、送る前に PR が merge 済みかを見る命令（calls には数えない。記録の gh と分けるため）。
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const pr = args[2] ?? '';
      const state = prs.has(pr) ? prs.get(pr) : 'MERGED';
      return state === undefined ? { status: 1, stdout: '', stderr: 'gh: not logged in' } : { status: 0, stdout: JSON.stringify({ state }), stderr: '' };
    }
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    const answer = answers.get([cmd, ...args].join(' '));
    if (answer !== undefined) return answer;
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
    prs,
    castlist,
    answers,
  };
}

/** 担当が名乗り、いちばん新しい依頼書の【done】を返す（TPM 担当の dismiss・続きの assign が、済んでいない依頼書で止まらないように）。 */
export function finish(w: World, key: string, address: string): void {
  const se = w.role(key, address);
  hello(se);
  reportDone(se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
}

/** Staff Engineer 担当の skill が在る、偽の roster の root（tpm assign --role staff-engineer は、skill が無ければ起こす前に止まる）。 */
export function staffRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-root-')));
  mkdirSync(join(root, 'skill-sets', 'core', '.claude', 'skills', 'staff-engineer'), { recursive: true });
  writeFileSync(join(root, 'skill-sets', 'core', '.claude', 'skills', 'staff-engineer', 'SKILL.md'), '# Staff Engineer 担当\n');
  return root;
}
