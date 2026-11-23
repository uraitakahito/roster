import { describe, expect, test } from 'vitest';
import { envOf, withEnv } from '../src/env.ts';

describe('envOf', () => {
  test('新しい名を読み、無ければ古い名（道具の名を替える前に起きた担当）を読む', () => {
    expect(envOf({ ROSTER_KEY: 'a', TPM_KEY: 'b' }, 'KEY')).toBe('a');
    expect(envOf({ TPM_KEY: 'b' }, 'KEY')).toBe('b');
    expect(envOf({}, 'KEY')).toBeUndefined();
  });

  test('空の字は書かなかったものとみなす。新しい名を空の字で書けば、古い名を読まない', () => {
    expect(envOf({ ROSTER_KEY: '' }, 'KEY')).toBeUndefined();
    expect(envOf({ TPM_KEY: '' }, 'KEY')).toBeUndefined();
    expect(envOf({ ROSTER_KEY: '', TPM_KEY: 'b' }, 'KEY')).toBeUndefined();
  });
});

describe('withEnv', () => {
  test('新しい名で書き、古い名を消す。undefined は新旧どちらも消す。ほかの物と元の env は変えない', () => {
    const env = { PATH: '/bin', TPM_PROJECT: '/old', TPM_STATE: '/old-state', ROSTER_STATE: '/s' };
    expect(withEnv(env, { PROJECT: '/new', STATE: undefined })).toEqual({ PATH: '/bin', ROSTER_PROJECT: '/new' });
    expect(env).toEqual({ PATH: '/bin', TPM_PROJECT: '/old', TPM_STATE: '/old-state', ROSTER_STATE: '/s' });
  });
});
