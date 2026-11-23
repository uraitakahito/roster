import { describe, expect, test } from 'vitest';
import { envOf, legacyEnvNotice, withEnv, withoutRosterEnv } from '../src/env.ts';

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
  test('古い名が残っていれば、替える名を並べた 1 行。空の字で書いた物も挙げる', () => {
    expect(legacyEnvNotice({ TPM_MODEL: 'claude-x', TPM_EFFORT: '' })).toBe('環境変数の古い名は読みません。新しい名に替えてください: TPM_MODEL → ROSTER_MODEL・TPM_EFFORT → ROSTER_EFFORT');
  });

  test('古い名が無ければ undefined。TPM 担当を指すコードの名などは挙げない', () => {
    expect(legacyEnvNotice({ ROSTER_MODEL: 'claude-x', TPM_TITLE: 'x' })).toBeUndefined();
  });
});
