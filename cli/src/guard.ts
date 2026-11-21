// guard: 担当が打つ shell の命令を、実行の前に見て、通すか止めるかを決める（Claude Code の PreToolUse hook から呼ばれる）。
// 止めるのは 2 つ。(1) project の設定（infra）に書いた環境に触る命令で、手続きを踏んでいない物。
// (2) 連携と課題管理の道具の直打ち（tpm を通さないと、記録と状態が抜ける）。
// (1) は命令の字全体に match の字が含まれるかで見る（共有の環境は、疑わしければ止める）。
// (2) は命令を単純な命令に分け、その頭（実際に打つ道具の命令）だけを見る。commit の文・grep の型・here-document に道具の名が入っても止めない。
// どちらも字で見るので、防げるのは「うっかり」まで。script に包んだ命令などはすり抜ける。確実な守りは、担当に渡す権限の方で行う。
import type { InfraEnv, RolesConfig } from './config.ts';
import type { RoleName } from './protocol.ts';
import { shellQuote, splitCommands } from './shell.ts';
import type { State } from './state.ts';

/** 環境を変えてよい担当。 */
const INFRA_ROLE: RoleName = 'devops-engineer';

/** 承認 1 件（`approvals/<環境>.jsonc`）。until を過ぎたら効かない。 */
export interface Approval {
  until: string
  note?: string
}

/** guard の答え。止めるときは、代わりにどうするかを reason に書く。 */
export type Verdict = { allow: true } | { allow: false, reason: string };

/** 直に打たせない道具の命令（単純な命令の語を空白でつないだ字の頭に当てる）と、代わりに使う tpm の命令。 */
const DIRECT: [pattern: RegExp, instead: string][] = [
  [/^cmux agent message\b/, 'tpm ask …・tpm report …（担当）、tpm notify・tpm answer・tpm dismiss（TPM 担当）'],
  [/^cmux set-status\b/, 'tpm wait <work|pm|tpm> "<何を>"'],
  [/^cmux (workspace create|new-workspace)\b/, 'tpm assign <Key> --role …'],
  [/^cmux (workspace close|close-workspace)\b/, 'tpm close <Key>'],
  [/^acli jira workitem (comment create|transition)\b/, 'tpm report …・tpm ask pm・tpm answer（記録は命令が書く）'],
  [/^gh issue (comment|close)\b/, 'tpm report …・tpm ask pm・tpm answer（記録は命令が書く）'],
];

/** 命令の頭にこれを書くと、道具の直打ちを通す（tpm 自身の開発と試しのため。環境の手続きには効かない）。 */
export const RAW = 'TPM_RAW=1';

/** guard に聞く 1 件。打った命令と、決めるのに要る設定・承認・時刻。 */
export interface Asked {
  command: string
  /** 打った担当。TPM 担当と、tpm が起こしていない session は undefined。 */
  role: RoleName | undefined
  config: Pick<RolesConfig, 'infra' | 'tracker'>
  /** 環境の名前 → 承認。 */
  approvals: Record<string, Approval | undefined>
  now: Date
}

/** 命令が触る環境（match のどれかを含む）。 */
export function touched(command: string, infra: Record<string, InfraEnv>): string[] {
  return Object.entries(infra).filter(([, env]) => env.match.some(m => command.includes(m))).map(([name]) => name);
}

/** 環境 1 つについて、この担当が今、変えてよいか。 */
export function judgeEnv(name: string, env: InfraEnv, role: RoleName | undefined, approval: Approval | undefined, now: Date): Verdict {
  if (env.guard === 'free') return { allow: true };
  if (role !== INFRA_ROLE) {
    return { allow: false, reason: `環境 ${name} を変えてよいのは DevOps Engineer 担当だけです。tpm ask devops --what … --why … で TPM 担当に頼んでください。` };
  }
  if (env.guard === 'tpm') return { allow: true };
  if (approval !== undefined && now.getTime() < Date.parse(approval.until)) return { allow: true };
  const expired = approval === undefined ? '' : `（承認は ${approval.until} で切れた）`;
  return {
    allow: false,
    reason: `環境 ${name} は、ほかの人と共有です。変えるには Product Manager の承認が要ります${expired}。何を・なぜ・何が止まるかを確認のページに書き（tpm page put）、tpm ask pm で送ってください。承認されたら TPM 担当が tpm infra approve ${name} で承認を書きます。`,
  };
}

/** 命令を通すか。環境の手続きを先に見て、次に道具の直打ちを見る。 */
export function judge(asked: Asked): Verdict {
  for (const name of touched(asked.command, asked.config.infra)) {
    const env = asked.config.infra[name];
    if (env === undefined) continue;
    const verdict = judgeEnv(name, env, asked.role, asked.approvals[name], asked.now);
    if (!verdict.allow) return verdict;
  }
  if (!asked.command.includes(RAW)) {
    const heads = splitCommands(asked.command).map(words => words.join(' '));
    for (const [pattern, instead] of DIRECT) {
      // 課題管理に GitHub の Issue を使わない project では、gh issue は課題管理の道具ではない。
      if (pattern.source.startsWith('^gh issue') && asked.config.tracker !== 'github') continue;
      if (heads.some(h => pattern.test(h))) {
        return { allow: false, reason: `道具を直に打つと、記録と状態が抜けます。代わりに: ${instead}。tpm 自身の開発や試しで直に打つなら、命令の頭に ${RAW} を付けてください。` };
      }
    }
  }
  return { allow: true };
}

const approvalFile = (name: string): string => `approvals/${name}.jsonc`;

/** 設定にある環境ごとの承認を読む。承認が無い環境は undefined。 */
export function readApprovals(state: State, infra: Record<string, InfraEnv>): Record<string, Approval | undefined> {
  return Object.fromEntries(Object.keys(infra).map(name => [name, state.read<Approval>(approvalFile(name))]));
}

/** 環境の承認を書く（`tpm infra approve`）。 */
export function writeApproval(state: State, name: string, approval: Approval): void {
  state.write(approvalFile(name), approval);
}

/** 環境の承認を消す（`tpm infra revoke`）。 */
export function removeApproval(state: State, name: string): void {
  state.remove(approvalFile(name));
}

/** hook の標準入力（PreToolUse）から、shell の命令を取り出す。Bash でなければ undefined。 */
export function commandOf(stdin: string): string | undefined {
  const input = JSON.parse(stdin) as { tool_name?: string, tool_input?: { command?: unknown } };
  if (input.tool_name !== 'Bash' || typeof input.tool_input?.command !== 'string') return undefined;
  return input.tool_input.command;
}

/** 担当の claude に渡す settings（--settings）。Bash の前に tpm guard を呼ぶ hook。hook の命令は shell が読むので、path を引用する。 */
export function guardSettings(tpmBin: string): string {
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${shellQuote(tpmBin)} guard` }] }] } });
}
