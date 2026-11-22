// 通知のバナー（cmux の通知の desktop）を、居場所の役割 × きっかけで出すか消すかを決める。I/O を持たない。
// 設定は利用者の $XDG_CONFIG_HOME/tpm/banner.jsonc（無ければ ~/.config/tpm/banner.jsonc）。バナーを見るのは project でなく人なので、project の config.jsonc には置かない。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROLE_NAMES } from './protocol.ts';
import { TpmError } from './skill-sets.ts';

/** バナーのきっかけ。turn は答え終わった、idle は入力待ちの催促、ask は許可/質問。 */
export const TRIGGERS = ['turn', 'idle', 'ask'] as const;
/** バナーのきっかけ。 */
export type Trigger = typeof TRIGGERS[number];

/** cmux の通知の category → きっかけ。ここに無い category は決めない（cmux のまま）。 */
export const CATEGORY_TRIGGER: Record<string, Trigger> = {
  'turn-complete': 'turn',
  'idle-reminder': 'idle',
  'needs-permission': 'ask',
};

/** show は出す、hide は消す、pm-wait はその回に tpm wait pm を打った時だけ出す。 */
export const CHOICES = ['show', 'hide', 'pm-wait'] as const;
/** 1 つのきっかけの出し方。 */
export type Choice = typeof CHOICES[number];

/** バナーを消す時に一緒に消せる物（cmux の通知の effects の名）。 */
export const WITH_BANNER = ['sound', 'paneFlash', 'reorderWorkspace'] as const;
/** バナーと一緒に消す物。 */
export type WithBanner = typeof WITH_BANNER[number];

/** 役割（tpm と ROLE_NAMES）か、ほかの役割をまとめる `*`。 */
export const BANNER_ROLES = ['tpm', ...ROLE_NAMES, '*'] as const;

/** 読んだ設定（書いていない欄は既定で埋めた物）。 */
export interface BannerConfig {
  banner: Record<string, Record<Trigger, Choice>>
  withBanner: WithBanner[]
}

/** 既定: TPM 担当と Auditor が Product Manager を待つ回と、どこでも許可/質問だけ出す。消す時は音も消す。 */
export const DEFAULT_BANNER: BannerConfig = {
  banner: {
    'tpm': { turn: 'pm-wait', idle: 'hide', ask: 'show' },
    // Auditor は Product Manager へじかに報告するので、報告して待つ回だけ出す。
    'auditor': { turn: 'pm-wait', idle: 'hide', ask: 'show' },
    '*': { turn: 'hide', idle: 'hide', ask: 'show' },
  },
  withBanner: ['sound'],
};

/** 設定の file。 */
export function bannerConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tpm', 'banner.jsonc');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 読んだ JSONC の値を設定にする。書いていない欄は既定で埋める。形が違えば TpmError。 */
export function toBannerConfig(raw: unknown): BannerConfig {
  if (raw === undefined) return DEFAULT_BANNER;
  if (!isObject(raw)) throw new TpmError('banner.jsonc は { "banner": …, "withBanner": … } の形にしてください');
  for (const k of Object.keys(raw)) {
    if (k !== 'banner' && k !== 'withBanner') throw new TpmError(`banner.jsonc の知らない欄: ${k}（banner・withBanner だけ）`);
  }
  const banner: BannerConfig['banner'] = structuredClone(DEFAULT_BANNER.banner);
  if (raw.banner !== undefined) {
    if (!isObject(raw.banner)) throw new TpmError('banner.jsonc の banner は、役割 → { turn・idle・ask } の形にしてください');
    for (const [role, triggers] of Object.entries(raw.banner)) {
      if (!(BANNER_ROLES as readonly string[]).includes(role)) throw new TpmError(`banner.jsonc の知らない役割: ${role}（${BANNER_ROLES.join('・')}）`);
      if (!isObject(triggers)) throw new TpmError(`banner.jsonc の banner.${role} は { turn・idle・ask } の形にしてください`);
      for (const [trigger, choice] of Object.entries(triggers)) {
        if (!(TRIGGERS as readonly string[]).includes(trigger)) throw new TpmError(`banner.jsonc の知らないきっかけ: ${role}.${trigger}（${TRIGGERS.join('・')}）`);
        if (!(CHOICES as readonly unknown[]).includes(choice)) throw new TpmError(`banner.jsonc の ${role}.${trigger} は ${CHOICES.join('・')} のどれかにしてください`);
      }
    }
    // 役割の欄は、書いたきっかけだけを * に上書きする。* を書けば、* の既定も替わる。
    const star = { ...banner['*']!, ...(raw.banner['*'] as Partial<Record<Trigger, Choice>> | undefined) };
    banner['*'] = star;
    for (const [role, triggers] of Object.entries(raw.banner)) {
      if (role === '*') continue;
      banner[role] = { ...(banner[role] ?? star), ...(triggers as Partial<Record<Trigger, Choice>>) };
    }
  }
  let withBanner = DEFAULT_BANNER.withBanner;
  if (raw.withBanner !== undefined) {
    if (!Array.isArray(raw.withBanner) || raw.withBanner.some(w => !(WITH_BANNER as readonly unknown[]).includes(w))) {
      throw new TpmError(`banner.jsonc の withBanner は ${WITH_BANNER.join('・')} の並びにしてください`);
    }
    withBanner = raw.withBanner as WithBanner[];
  }
  return { banner, withBanner };
}

/** 役割ときっかけの出し方。役割の欄が無ければ `*`。 */
export function choiceOf(config: BannerConfig, role: string, trigger: Trigger): Choice {
  return (config.banner[role] ?? config.banner['*']!)[trigger];
}

/** 決めるのに要る物。時刻は ISO 8601 の字。 */
export interface BannerInput {
  role: string
  trigger: Trigger
  /** その居場所が最後に打った tpm wait の種類と時刻。 */
  lastWait?: { kind: string, at: string }
  /** その居場所の前の「答え終わった」の時刻。 */
  lastTurn?: string
}

/** 決めたこと。show が false ならバナー（と withBanner の物）を消す。 */
export interface BannerDecision {
  show: boolean
  reason: string
}

/** 出すか消すかを決める。pm-wait は、前の「答え終わった」より後に tpm wait pm を打っていれば出す。前の回の記録が無ければ出す（漏らさない側に倒す）。 */
export function decide(config: BannerConfig, input: BannerInput): BannerDecision {
  const choice = choiceOf(config, input.role, input.trigger);
  if (choice !== 'pm-wait') return { show: choice === 'show', reason: `${input.role}.${input.trigger}=${choice}` };
  if (input.trigger !== 'turn') return { show: true, reason: `${input.role}.${input.trigger}=pm-wait（答え終わった時だけ見る。ほかは出す）` };
  const waitedPm = input.lastWait?.kind === 'pm';
  if (!waitedPm) return { show: false, reason: `${input.role}.turn=pm-wait（最後の wait が pm でない）` };
  if (input.lastTurn === undefined) return { show: true, reason: `${input.role}.turn=pm-wait（前の回の記録が無いので出す）` };
  const fresh = Date.parse(input.lastWait!.at) > Date.parse(input.lastTurn);
  return { show: fresh, reason: `${input.role}.turn=pm-wait（この回に wait pm を${fresh ? '打った' : '打っていない'}）` };
}
