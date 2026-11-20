import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { readRolesConfig } from '../src/config.ts';
import { TpmError } from '../src/skill-sets.ts';

let dir: string;
let n = 0;
const config = (text: string): string => {
  const file = join(dir, `config-${n++}.json`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-config-')));
});

describe('readRolesConfig', () => {
  test('ファイルが無ければ既定（課題管理なし・cmux・環境の宣言なし）', () => {
    expect(readRolesConfig(join(dir, 'nope.json'))).toEqual({ tracker: 'none', transport: 'cmux', infra: {} });
  });

  test('欄が無ければ既定', () => {
    expect(readRolesConfig(config('{ "skill-sets": ["dependabot"] }'))).toEqual({ tracker: 'none', transport: 'cmux', infra: {} });
  });

  test('書いた道具と環境を返す', () => {
    const file = config(JSON.stringify({
      tracker: 'github',
      transport: 'file',
      infra: { 'apple-container': { guard: 'free', match: ['container '] }, 'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] } },
    }));
    expect(readRolesConfig(file)).toEqual({
      tracker: 'github',
      transport: 'file',
      infra: { 'apple-container': { guard: 'free', match: ['container '] }, 'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] } },
    });
  });

  test.each([
    ['知らない課題管理', '{ "tracker": "linear" }', /tracker は jira・github・none/],
    ['知らない連携', '{ "transport": "tmux" }', /transport は cmux・file/],
    ['配列の infra', '{ "infra": [] }', /infra は/],
    ['大文字の環境の名前', '{ "infra": { "AWS": { "guard": "pm", "match": ["aws "] } } }', /環境の名前は/],
    ['知らない級', '{ "infra": { "x": { "guard": "open", "match": ["x "] } } }', /infra\.x\.guard は free・tpm・pm/],
    ['級が無い', '{ "infra": { "x": { "match": ["x "] } } }', /infra\.x\.guard がありません/],
    ['match が無い', '{ "infra": { "x": { "guard": "pm" } } }', /infra\.x\.match は/],
    ['空の match', '{ "infra": { "x": { "guard": "pm", "match": [] } } }', /infra\.x\.match は/],
    ['空白だけの match', '{ "infra": { "x": { "guard": "pm", "match": [" "] } } }', /infra\.x\.match は/],
  ])('%sなら TpmError', (_, text, message) => {
    const file = config(text);
    expect(() => readRolesConfig(file)).toThrow(TpmError);
    expect(() => readRolesConfig(file)).toThrow(message);
  });
});
