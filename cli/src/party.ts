// 担当の組（名簿の Key と、起こした回）。送った記録の送り手・受け手と、配りの受け手の名（mail.ts）の元。
import { envOf } from './env.ts';

/**
 * 送り手・受け手の担当: 名簿の Key（TPM 担当は tpm）と、起こしの id（$ROSTER_LAUNCH・名簿の launch。castlist を設定した時だけある）。
 * 届いた所で、宛先の担当と受けた session を比べるのに使う（roster returned check）。
 */
export interface Party {
  key: string
  launch?: string
}

/** TPM 担当の担当の名（Party の key）。 */
export const TPM_PARTY = 'tpm';

/** 自分の担当（$ROSTER_KEY が無ければ TPM 担当）。 */
export function selfParty(env: NodeJS.ProcessEnv): Party {
  const launch = envOf(env, 'LAUNCH');
  return { key: envOf(env, 'KEY') || TPM_PARTY, ...(launch ? { launch } : {}) };
}
