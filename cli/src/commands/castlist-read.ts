// tpm castlist find・show・lineage・events・settings: castlist の監査の検索を読むだけの命令（まだ中身が無い）。
import type { Context } from '../context.ts';

/** 出す形。json なら castlist の答えをそのまま出す。 */
export interface JsonOption {
  json?: boolean
}

/** `tpm castlist find` の旗（GET /v1/actors の引数）。 */
export interface FindOptions extends JsonOption {
  label?: string[]
  binding?: string
  at?: string
  activeFrom?: string
  activeTo?: string
  active?: string
  model?: string
  effort?: string
  launchedBy?: string
  skewed?: boolean
  kind?: string
  sort?: string
  order?: string
  limit?: string
  after?: string
}

/** `tpm castlist lineage` の旗。 */
export interface LineageOptions extends JsonOption {
  direction?: string
  depth?: string
  type?: string
}

/** `tpm castlist events` の旗（GET /v1/events の引数）。 */
export interface EventsOptions extends JsonOption {
  type?: string[]
  actor?: string
  from?: string
  to?: string
  reason?: string
  source?: string
  skewed?: boolean
  limit?: string
  after?: string
}

/** `tpm castlist settings` の旗。 */
export interface SettingsOptions extends JsonOption {
  actor?: string
  at?: string
  model?: string
  effort?: string
  source?: string
  from?: string
  to?: string
  mismatch?: boolean
  skewed?: boolean
  limit?: string
  after?: string
}

/** まだ中身が無い。 */
export function castlistFind(_ctx: Context, _options: FindOptions): string[] {
  return [];
}

/** まだ中身が無い。 */
export function castlistShow(_ctx: Context, _target: string, _options: JsonOption): string[] {
  return [];
}

/** まだ中身が無い。 */
export function castlistLineage(_ctx: Context, _id: string, _options: LineageOptions): string[] {
  return [];
}

/** まだ中身が無い。 */
export function castlistEvents(_ctx: Context, _options: EventsOptions): string[] {
  return [];
}

/** まだ中身が無い。 */
export function castlistSettings(_ctx: Context, _options: SettingsOptions): string[] {
  return [];
}
