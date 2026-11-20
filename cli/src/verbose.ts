// --verbose で stderr に出す説明。tpm が何をどこから読み、どの skill セットの skill を足すかを並べる。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { skillSetDir } from './skill-sets.ts';

/** 説明に使う、tpm が求めた値。 */
export interface Resolved {
  /** 利用者が渡した folder。渡さなければ undefined。 */
  given: string | undefined
  dir: string
  root: string
  configFile: string
  skillSets: string[]
}

/** 見出しの欄の幅（いちばん長い見出し skill-sets の 10 字）。 */
const LABEL_WIDTH = 10;

/** skill セットの folder の .claude/skills のうち、SKILL.md を持つ folder の名前を名前順に返す（_shared などは持たないので出ない）。 */
export function listSkills(skillSetDir: string): string[] {
  const skills = join(skillSetDir, '.claude', 'skills');
  return readdirSync(skills, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(skills, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
}

/** 説明の行を返す（先頭の `tpm: ` は付けない）。 */
export function explain(r: Resolved): string[] {
  const skillSets = ['core', ...r.skillSets];
  // skill セットの名前の欄は、上の行の見出しとそろえる。
  const width = Math.max(LABEL_WIDTH, ...skillSets.map(s => s.length));
  const line = (label: string, text: string): string => `${label.padEnd(width)}  ${text}`;
  return [
    line('folder', `${r.dir}（${r.given === undefined ? '今いる folder' : `渡された値: ${r.given}`}）`),
    line('repo', r.root),
    line('config', `${r.configFile}（${existsSync(r.configFile) ? 'あり' : 'なし'}）`),
    line('skill-sets', r.skillSets.length ? `${r.skillSets.join(' ')}（config の skill-sets から。core と重なりは除いた）` : 'なし（core だけ）'),
    ...skillSets.map((s) => {
      const dir = skillSetDir(r.root, s);
      const skills = listSkills(dir);
      return line(s, `${dir} → ${skills.length ? skills.map(k => `/${k}`).join(' ') : '（skill なし）'}`);
    }),
  ];
}
