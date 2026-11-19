import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { explain, listSkills } from '../src/verbose.js';

// skill セット core（skill 2 つと _shared）と empty（skill なし）を持つ偽の repo を作る。
let root: string;
const skill = (skillSet: string, name: string, withSkillMd = true): void => {
  const d = join(root, skillSet, '.claude', 'skills', name);
  mkdirSync(d, { recursive: true });
  if (withSkillMd) writeFileSync(join(d, 'SKILL.md'), '');
};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-verbose-')));
  skill('core', 'tpm');
  skill('core', 'devops-engineer');
  skill('core', '_shared', false);
  writeFileSync(join(root, 'core', '.claude', 'skills', 'note.md'), '');
  mkdirSync(join(root, 'empty', '.claude', 'skills'), { recursive: true });
});

describe('listSkills', () => {
  test('SKILL.md を持つ folder だけを名前順に返す', () => {
    expect(listSkills(join(root, 'core'))).toEqual(['devops-engineer', 'tpm']);
  });

  test('skill が無ければ空', () => {
    expect(listSkills(join(root, 'empty'))).toEqual([]);
  });
});

describe('explain', () => {
  test('folder を渡さず config も無ければ、そう書き、core だけを並べる', () => {
    expect(explain({ given: undefined, dir: '/w', root, configFile: '/w/nope.json', skillSets: [] })).toEqual([
      'folder      /w（今いる folder）',
      `repo        ${root}`,
      'config      /w/nope.json（なし）',
      'skill-sets  なし（core だけ）',
      `core        ${root}/core → /devops-engineer /tpm`,
    ]);
  });

  test('渡した値・config のあり・skill セットごとの skill を書く', () => {
    const configFile = join(root, 'config.json');
    writeFileSync(configFile, '{}');
    expect(explain({ given: '.', dir: '/w', root, configFile, skillSets: ['empty'] })).toEqual([
      'folder      /w（渡された値: .）',
      `repo        ${root}`,
      `config      ${configFile}（あり）`,
      'skill-sets  empty（config の skill-sets から。core と重なりは除いた）',
      `core        ${root}/core → /devops-engineer /tpm`,
      `empty       ${root}/empty → （skill なし）`,
    ]);
  });
});
