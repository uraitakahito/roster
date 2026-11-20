// 担当のあいだの決まりのうち、コードが持つ物: 担当の種類・見出しの表・状態の字の形。
// 「いつ・なぜ送るか」は skill の文（_shared/protocol.md）に書く。ここを変えたら、その表も合わせる。
import type { NoteKind } from './tracker/types.ts';

/** TPM 担当の居場所の題（知らせの差出人にも使う）。 */
export const TPM_TITLE = 'Technical Program Manager';

/**
 * tpm の命令の一覧。skill と docs が書いた `tpm <命令>` が在るかを docs-site/scripts/check-refs.mjs がこれで見る
 * （その検査は cli の依存を入れずに動くので、命令の木ではなくこの表を読む）。命令の木と揃っているかは試験が見る。
 */
export const COMMANDS = [
  'start',
  'roles',
  'assign',
  'close',
  'hello',
  'inbox',
  'wait',
  'show',
  'ask tpm',
  'ask pm',
  'ask devops',
  'report merged',
  'report doc-fix',
  'report done',
  'report end',
  'report merge-request',
  'report not-yet',
  'report recreated',
  'answer',
  'notify',
  'dismiss',
  'infra list',
  'infra approve',
  'infra revoke',
  'infra run',
  'guard',
  'run-role',
] as const;

/** 担当を起こすときの claude の旗（--model・--effort・--permission-mode）。 */
export interface RoleSettings {
  model: string
  effort: string
  permissionMode: string
}

/** 担当の種類 1 つの決まり。 */
export interface RoleDef {
  /** 題と記録に書く名前。 */
  label: string
  /** 起こしたときの最初の入力。 */
  prompt: string
  defaults: RoleSettings
  /** 居場所の題。TPM 担当は同じ鍵の担当をこの題でも見分けられる。 */
  title: (key: string, short: string) => string
  /** 【片付け】を待たずに【終わり】を送ってよいか（PR 1 本を受け持つ担当は、merge の知らせで終える）。 */
  endsWithoutDismiss: boolean
}

/** tpm start が起こす TPM 担当の model など。 */
export const TPM_SETTINGS: RoleSettings = { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' };

/** 担当の種類（TPM 担当は別。TPM_TITLE・TPM_SETTINGS）。 */
export const ROLES = {
  'software-engineer': {
    label: 'Software Engineer',
    prompt: '/software-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`Software Engineer <鍵>: <短い題>`）。 */
    title: (key, short) => `Software Engineer ${key}: ${short}`,
    endsWithoutDismiss: false,
  },
  'devops-engineer': {
    label: 'DevOps Engineer',
    prompt: '/devops-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'low', permissionMode: 'bypassPermissions' },
    /** 居場所の題。DevOps Engineer 担当は 1 人だけなので、鍵を付けない。 */
    title: () => 'DevOps Engineer',
    endsWithoutDismiss: false,
  },
  'sustaining-engineer': {
    label: 'Sustaining Engineer',
    prompt: '/sustaining-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`Sustaining Engineer <鍵>`）。 */
    title: key => `Sustaining Engineer ${key}`,
    endsWithoutDismiss: true,
  },
} as const satisfies Record<string, RoleDef>;

/** 担当の種類の名前（`--role` に書く字）。 */
export type RoleName = keyof typeof ROLES;
/** 担当の種類の名前の一覧。 */
export const ROLE_NAMES = Object.keys(ROLES) as RoleName[];

/** 見出し 1 つ。from は送る側、record は課題に書く記録の種類（書かなければ無し）。 */
export interface Heading {
  name: string
  from: 'role' | 'tpm'
  record?: NoteKind
}

/** 見出しの表。鍵は命令の中での呼び名。 */
export const HEADINGS = {
  'ask-tpm': { name: '相談(TPM)', from: 'role' },
  'ask-pm': { name: 'PM への依頼', from: 'role', record: '確認' },
  'ask-devops': { name: 'DevOps への依頼', from: 'role' },
  'doc-fix': { name: 'ドキュメント修正', from: 'role', record: '文書の修正' },
  'merged': { name: 'merge 済み', from: 'role' },
  'done': { name: '完成', from: 'role' },
  'end': { name: '終わり', from: 'role', record: '結果' },
  'merge-request': { name: 'merge の依頼', from: 'role' },
  'not-yet': { name: 'まだ', from: 'role' },
  'recreated': { name: '作り直し', from: 'role' },
  'brief': { name: '依頼', from: 'tpm' },
  'answer': { name: 'PM の回答', from: 'tpm', record: '決定' },
  'notify': { name: '連絡', from: 'tpm' },
  'dismiss': { name: '片付け', from: 'tpm' },
} as const satisfies Record<string, Heading>;

/** 見出しの名前（`ask-tpm` など）。 */
export type HeadingId = keyof typeof HEADINGS;

/** 知らせの字。 */
export const message = (id: HeadingId, body: string): string => `【${HEADINGS[id].name}】${body}`;

/** 状態 wait の字。「今、誰が何を待っているか」を 1 つだけ出す。 */
export const WAIT = {
  /** 自分が動いている。 */
  work: (what: string) => `作業中: ${what}`,
  /** Product Manager の答えを待つ。 */
  pm: (what: string) => `回答待ち(PM): ${what}`,
  /** TPM 担当の答えを待つ。 */
  tpm: (what: string) => `回答待ち(TPM): ${what}`,
} as const;
/** 待ちの種類（`tpm wait` の kind）。 */
export type WaitKind = keyof typeof WAIT;

/** 【完成】の後の待ち。 */
export const WAIT_NEXT_BRIEF = WAIT.tpm('次の依頼');
/** 【終わり】の後の待ち。 */
export const WAIT_CLOSE = WAIT.tpm('workspace を閉じる');

/** model の id を状態の字にする（claude-opus-5-5 → Opus 5.5）。形が違えばそのまま。 */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  if (m?.[1] === undefined) return model;
  return `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/** 状態 model の字（Opus 5.5 · medium）。 */
export const modelStatus = (model: string, effort: string): string => `${modelLabel(model)} · ${effort}`;
