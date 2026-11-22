import { describe, expect, test } from 'vitest';
import { ROLES, TPM_SETTINGS } from '../src/protocol.ts';
import { resolveSettings } from '../src/settings.ts';

const ENV = { TPM_MODEL: 'claude-sonnet-5-5', TPM_EFFORT: 'high', TPM_PERMISSION_MODE: 'acceptEdits' };

describe('resolveSettings', () => {
  test('何も無ければコードの既定（担当ごと・TPM 担当）', () => {
    expect(resolveSettings('devops-engineer', { env: {} })).toEqual(ROLES['devops-engineer'].defaults);
    expect(resolveSettings('tpm', { env: {} })).toEqual(TPM_SETTINGS);
    expect(resolveSettings('auditor', { env: {} })).toEqual({ model: 'claude-fable-5-2', effort: 'high', permissionMode: 'bypassPermissions' });
    expect(resolveSettings('staff-engineer', { env: {} })).toEqual({ model: 'claude-opus-5-5', effort: 'high', permissionMode: 'bypassPermissions' });
  });

  test('環境変数はコードの既定に勝つ', () => {
    expect(resolveSettings('software-engineer', { env: ENV })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'acceptEdits' });
    expect(resolveSettings('tpm', { env: ENV })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'acceptEdits' });
  });

  test('欄ごとに 旗 > config の担当の欄 > 環境変数 > コードの既定', () => {
    expect(resolveSettings('software-engineer', {
      flags: { model: 'claude-fable-5-2', effort: undefined },
      config: { model: 'claude-opus-5-5', effort: 'low' },
      env: { TPM_MODEL: 'claude-sonnet-5-5', TPM_EFFORT: 'high' },
    })).toEqual({ model: 'claude-fable-5-2', effort: 'low', permissionMode: 'bypassPermissions' });
  });

  test('空の環境変数は書かなかったものとみなす', () => {
    expect(resolveSettings('software-engineer', { env: { TPM_MODEL: '', TPM_EFFORT: '' } })).toEqual(ROLES['software-engineer'].defaults);
  });
});
