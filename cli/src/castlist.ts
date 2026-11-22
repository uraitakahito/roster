// castlist（アクターの台帳）への組み込み。まだ形だけ（試験を先に書く段の仮の物）。
import type { RoleName } from './protocol.ts';

/** 起こす castlist の版。 */
export const CASTLIST_VERSION = '0.0.0';

/** 状態の folder から issuer を作る（仮）。 */
export const castlistIssuer = (_stateDir: string): string => '';

/** 担当の名の接頭辞（仮）。 */
export const seatPrefix = (_key: string, _role: RoleName): string => '';
