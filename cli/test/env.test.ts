import { describe, expect, test } from 'vitest';
import { assertNoLegacySeat, envOf, legacyEnvNotice, withEnv, withoutRosterEnv } from '../src/env.ts';
import { createContext } from '../src/context.ts';

describe('envOf', () => {
  test('ROSTER_<名> を読む。古い名 TPM_<名> は読まない', () => {
    expect(envOf({ ROSTER_KEY: 'a', TPM_KEY: 'b' }, 'KEY')).toBe('a');
    expect(envOf({ TPM_KEY: 'b' }, 'KEY')).toBeUndefined();
    expect(envOf({}, 'KEY')).toBeUndefined();
  });

  test('空の字は書かなかったものとみなす', () => {
    expect(envOf({ ROSTER_KEY: '' }, 'KEY')).toBeUndefined();
  });
});

describe('withEnv', () => {
  test('値を書き、undefined は消す。ほかの物と元の env は変えない', () => {
    const env = { PATH: '/bin', ROSTER_STATE: '/s' };
    expect(withEnv(env, { PROJECT: '/new', STATE: undefined })).toEqual({ PATH: '/bin', ROSTER_PROJECT: '/new' });
    expect(env).toEqual({ PATH: '/bin', ROSTER_STATE: '/s' });
  });

  test('withoutRosterEnv は ROSTER_* をみな抜く', () => {
    expect(withoutRosterEnv({ PATH: '/bin', ROSTER_KEY: 'k', ROSTER_STATE: '/s' })).toEqual({ PATH: '/bin' });
  });
});

describe('legacyEnvNotice', () => {
  test('利用者が書く古い名が残っていれば、替える名を並べた 1 行。空の字で書いた物も挙げる', () => {
    expect(legacyEnvNotice({ TPM_MODEL: 'claude-x', TPM_EFFORT: '' })).toEqual(['環境変数の古い名は読みません。新しい名に替えてください: TPM_MODEL → ROSTER_MODEL・TPM_EFFORT → ROSTER_EFFORT']);
  });

  test('起こしの印の古い名は、替えるのでなく起こし直す 1 行', () => {
    expect(legacyEnvNotice({ TPM_LAUNCH: 'x', TPM_LAUNCH_FRESH: '1' })).toEqual(['この TPM 担当は、道具の名を替える前の roster start の 1 行で起きています（TPM_LAUNCH・TPM_LAUNCH_FRESH）。roster start の 1 行で起こし直してください']);
  });

  test('古い名が無い・新しい名も在る・コードの名（TPM_TITLE）なら、何も出さない', () => {
    expect(legacyEnvNotice({ ROSTER_MODEL: 'claude-x', TPM_TITLE: 'x' })).toEqual([]);
    expect(legacyEnvNotice({ ROSTER_MODEL: 'a', TPM_MODEL: 'b' })).toEqual([]);
  });
});

describe('assertNoLegacySeat', () => {
  test('担当の名を古い名だけで持つ居場所（道具の名を替える前に起きた担当）は止める。roster のどの命令も（createContext）', () => {
    const old = { TPM_KEY: 't-x7k2', TPM_ROLE: 'software-engineer' };
    expect(() => assertNoLegacySeat(old)).toThrow('道具の名を替える前に起きた居場所です（環境変数 TPM_KEY・TPM_ROLE。roster は古い名を読みません）。この居場所を閉じ、TPM 担当が起こし直してください');
    expect(() => createContext(old)).toThrow(/道具の名を替える前に起きた居場所です/);
  });

  test('新しい名も在る・利用者の書く名だけなら止めない', () => {
    expect(() => assertNoLegacySeat({ ROSTER_KEY: 'k', TPM_KEY: 'k' })).not.toThrow();
    expect(() => assertNoLegacySeat({ TPM_MODEL: 'claude-x' })).not.toThrow();
  });
});
