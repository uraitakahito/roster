// tpm castlist …（hook が呼ぶ）。まだ形だけ（試験を先に書く段の仮の物）。
import type { Context } from '../context.ts';

/** SessionStart の hook（仮。何もしない）。 */
export function sessionStart(_ctx: Context, _stdin: string): void {}

/** SessionEnd の hook（仮。何もしない）。 */
export function sessionEnd(_ctx: Context, _stdin: string): void {}
