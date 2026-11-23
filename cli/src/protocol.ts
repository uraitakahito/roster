// 担当のあいだの決まりのうち、コードが持つ物: 担当の種類・見出しの表・状態の字の形。
// 「いつ・なぜ送るか」は skill の文（_shared/protocol.md）に書く。ここを変えたら、その表も合わせる。
import type { NoteKind } from './tracker/types.ts';

/** TPM 担当の居場所の題（メッセージの差出人にも使う）。 */
export const TPM_TITLE = 'Technical Program Manager';

/**
 * tpm の命令の一覧。skill と docs が書いた `tpm <命令>` が在るかを docs-site/scripts/check-refs.mjs がこれで見る
 * （その検査は cli の依存を入れずに動くので、命令の木ではなくこの表を読む）。命令の木と揃っているかは試験が見る。
 */
export const COMMANDS = [
  'start',
  'roles',
  'key',
  'assign',
  'close',
  'hello',
  'inbox',
  'wait',
  'show',
  'ask tpm',
  'ask pm',
  'ask devops',
  'ask review',
  'report merged',
  'report doc-fix',
  'report done',
  'report end',
  'report incident',
  'report audit',
  'report decided',
  'report review',
  'report merge-request',
  'report not-yet',
  'report recreated',
  'answer',
  'notify',
  'dismiss',
  'review list',
  'incident add',
  'incident review',
  'incident tag',
  'incident assign',
  'incident drop',
  'incident close',
  'incident follow',
  'incident timeline',
  'audit start',
  'audit begin',
  'audit fresh',
  'infra list',
  'infra approve',
  'infra revoke',
  'infra run',
  'issue view',
  'page put',
  'page path',
  'page list',
  'page reply',
  'page import',
  'page delete',
  'file put',
  'file path',
  'file list',
  'file delete',
  'guard',
  'returned check',
  'returned show',
  'castlist session-start',
  'castlist session-end',
  'castlist find',
  'castlist show',
  'castlist lineage',
  'castlist events',
  'castlist settings',
  'run-role',
  'banner hook',
  'banner setup',
  'banner check',
  'banner log',
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
  /** 居場所の題（メッセージの差出人にも使う）。担当の名は略す（記録には label を書く）。TPM 担当は同じ Key の担当をこの題でも見分けられる。 */
  title: (key: string, short: string) => string
  /**
   * 居場所の色（cmux の色の名。サイドバーの左の端の帯）。役割ごとに 1 色で、帯の色で役割が分かる。
   * 選んだ居場所の地の青と紛れない色（青・紺・藍・水色・青緑・灰は使わない）で、暗い画面で地から浮く色。
   */
  color: string
  /** 【dismiss】を待たずに【end】を送ってよいか（PR 1 本を受け持つ担当は、merge のメッセージで終える）。 */
  endsWithoutDismiss: boolean
}

/** TPM 担当の居場所の色（RoleDef の color と同じ決め）。名乗る時に自分に付ける。 */
export const TPM_COLOR = 'Amber';

/** tpm start が起こす TPM 担当の model など。 */
export const TPM_SETTINGS: RoleSettings = { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' };

/** Auditor の席の課題の Key（席は project に 1 つだけ）。 */
export const AUDIT_KEY = 'audit';

/** 担当の種類（TPM 担当は別。TPM_TITLE・TPM_SETTINGS）。 */
export const ROLES = {
  'software-engineer': {
    label: 'Software Engineer',
    prompt: '/software-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`SWE <Key>: <短い題>`）。サイドバーで短い題が切れないよう、担当の名を略す。 */
    title: (key, short) => `SWE ${key}: ${short}`,
    color: 'Green',
    endsWithoutDismiss: false,
  },
  'devops-engineer': {
    label: 'DevOps Engineer',
    prompt: '/devops-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'low', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`DevOps`）。DevOps Engineer 担当は 1 人だけなので、Key を付けない。 */
    title: () => 'DevOps',
    color: 'Orange',
    endsWithoutDismiss: false,
  },
  'sustaining-engineer': {
    label: 'Sustaining Engineer',
    prompt: '/sustaining-engineer',
    defaults: { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`Sustaining <Key>`）。 */
    title: key => `Sustaining ${key}`,
    color: 'Magenta',
    endsWithoutDismiss: true,
  },
  'staff-engineer': {
    label: 'Staff Engineer',
    prompt: '/staff-engineer',
    /** Software Engineer 担当と同じ model で、effort を 1 段上げる（書いた者より深く見る）。 */
    defaults: { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`レビュー <課題の Key>: <見る物>`）。見る物は頼みから命令が作り（reviews.ts の reviewLabel）、頼みのたびに替える。課題の担当の隣に、課題ごとに立つ。 */
    title: (key, target) => `レビュー ${key}: ${target}`,
    color: 'Purple',
    endsWithoutDismiss: false,
  },
  'auditor': {
    label: 'Auditor',
    /** 起きたら名乗って待つ。監査は Product Manager がその席で `/audit` を呼んで始める。 */
    prompt: '/audit hello',
    defaults: { model: 'claude-fable-5-2', effort: 'high', permissionMode: 'bypassPermissions' },
    /** 居場所の題（`Audit`）。Auditor の席は 1 つだけなので、Key を付けない。 */
    title: () => 'Audit',
    color: 'Olive',
    endsWithoutDismiss: false,
  },
} as const satisfies Record<string, RoleDef>;

/** 担当の種類の名前（`--role` に書く字）。 */
export type RoleName = keyof typeof ROLES;
/** 担当の種類の名前の一覧。 */
export const ROLE_NAMES = Object.keys(ROLES) as RoleName[];

/**
 * 見出し 1 つ。from は送る側、record は課題に書く記録の種類（書かなければ無し）。
 * peer は、担当から TPM 担当へでなく、担当から担当へじかに届く見出し（レビューの頼みと判定。課題の担当と、その課題の Staff Engineer 担当の席の間だけ）。
 */
export interface Heading {
  from: 'role' | 'tpm'
  record?: NoteKind
  peer?: true
}

/** 見出しの表。鍵は見出しの名（【ask-tpm】など）で、命令の中での呼び名と同じ。 */
export const HEADINGS = {
  'ask-tpm': { from: 'role' },
  'ask-pm': { from: 'role', record: '確認' },
  'ask-devops': { from: 'role' },
  // 課題の担当が、計画や PR のレビューを頼む。Staff Engineer 担当の席へじかに届く（席が無ければ、命令が起こして依頼書で渡す）。
  'ask-review': { from: 'role', peer: true },
  'doc-fix': { from: 'role', record: '文書の修正' },
  'merged': { from: 'role' },
  'done': { from: 'role' },
  'end': { from: 'role', record: '結果' },
  // 課題管理には書かない（台帳の中身は、tpm を動かす機械の外に出さない）。
  'incident': { from: 'role' },
  // Auditor だけが送る。audit は Product Manager へじかに出した報告の写し、decided は Product Manager の決定。
  'audit': { from: 'role' },
  'decided': { from: 'role' },
  // Staff Engineer 担当だけが送る。レビューのページと判定。頼んだ課題の担当へじかに届く。
  'review': { from: 'role', record: 'レビュー', peer: true },
  // 新しい session の始まりに、tpm の hook（tpm returned check）が、前の session 宛てに届いたメッセージを TPM 担当へ返す。台帳には hook が直に書く。
  'returned': { from: 'role' },
  'merge-request': { from: 'role' },
  'not-yet': { from: 'role' },
  'recreated': { from: 'role' },
  'brief': { from: 'tpm' },
  'answer': { from: 'tpm', record: '決定' },
  'notify': { from: 'tpm' },
  'dismiss': { from: 'tpm' },
} as const satisfies Record<string, Heading>;

/** 見出しの名（`ask-tpm` など）。 */
export type HeadingId = keyof typeof HEADINGS;

/** メッセージの書式。 */
export const message = (id: HeadingId, body: string): string => `【${id}】${body}`;

/** 状態 wait の字。「今、誰が何を待っているか」を 1 つだけ出す。 */
export const WAIT = {
  /** 自分が動いている。 */
  work: (what: string) => `作業中: ${what}`,
  /** Product Manager の答えを待つ。 */
  pm: (what: string) => `回答待ち(PM): ${what}`,
  /** TPM 担当の答えを待つ。 */
  tpm: (what: string) => `回答待ち(TPM): ${what}`,
  /** レビューの相手を待つ（課題の担当は判定を、Staff Engineer 担当は次の頼みを）。 */
  review: (what: string) => `回答待ち(レビュー): ${what}`,
} as const;
/** 待ちの種類（`tpm wait` の kind）。 */
export type WaitKind = keyof typeof WAIT;

/** 【done】の後の待ち。 */
export const WAIT_NEXT_BRIEF = WAIT.tpm('次の依頼');
/** 【end】の後の待ち。 */
export const WAIT_CLOSE = WAIT.tpm('workspace を閉じる');

/** model の id を状態の字にする（claude-opus-5-5 → Opus 5.5）。形が違えばそのまま。 */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  if (m?.[1] === undefined) return model;
  return `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/** 状態 model の字（Opus 5.5 · medium）。 */
export const modelStatus = (model: string, effort: string): string => `${modelLabel(model)} · ${effort}`;
