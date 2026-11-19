// --verbose で stderr に出す説明。tpm が何をどこから読み、どの束の skill を足すかを並べる。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 説明に使う、tpm が求めた値。 */
export interface Resolved {
  /** 利用者が渡した folder。渡さなければ undefined。 */
  given: string | undefined
  dir: string
  root: string
  configFile: string
  packs: string[]
}

/** 束の folder の .claude/skills のうち、SKILL.md を持つ folder の名前を名前順に返す（_shared などは持たないので出ない）。 */
export function listSkills(packDir: string): string[] {
  const skills = join(packDir, '.claude', 'skills');
  return readdirSync(skills, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(skills, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
}

/** 説明の行を返す（先頭の `tpm: ` は付けない）。 */
export function explain(r: Resolved): string[] {
  const packs = ['core', ...r.packs];
  // 束の名前の欄は、上の行の見出し（folder など 6 字）とそろえる。
  const width = Math.max(6, ...packs.map(p => p.length));
  return [
    `folder  ${r.dir}（${r.given === undefined ? '今いる folder' : `渡された値: ${r.given}`}）`,
    `repo    ${r.root}`,
    `config  ${r.configFile}（${existsSync(r.configFile) ? 'あり' : 'なし'}）`,
    `packs   ${r.packs.length ? `${r.packs.join(' ')}（config の packs から。core と重なりは除いた）` : 'なし（core だけ）'}`,
    ...packs.map((p) => {
      const dir = join(r.root, p);
      const skills = listSkills(dir);
      return `${p.padEnd(width)}  ${dir} → ${skills.length ? skills.map(s => `/${s}`).join(' ') : '（skill なし）'}`;
    }),
  ];
}
