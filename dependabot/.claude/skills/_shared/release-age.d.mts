// release-age.mjs の型。skill は release-age.mjs を npm install なしで node で直に呼ぶので JS のまま置き、
// TypeScript の試験（release-age.test.ts）から import するための型だけをここに書く。

export interface Dependency {
  name: string
  version?: string
  updateType?: string
  source?: 'lockfile' | 'workflow'
}

export interface Commit {
  author: string
  message: string
}

export type Lookup = (ecosystem: string, name: string, version: string) => Promise<string | null> | string | null;

export interface JudgeRow {
  name: string
  version: string | null
  publishedAt: string | null
  hours: number | null
}

export interface JudgeResult {
  eligible: boolean | 'undetermined'
  eligibleAt: string | null
  ecosystem: string
  deps: JudgeRow[]
}

export const HOURS: number;
export const EXIT: { eligible: 0, notYet: 10, undetermined: 20, error: 1 };

export function parseUpdatedDependencies(message: string): Dependency[];
export function ecosystemFromBranch(ref: string): string;
export function versionsFromDiff(diff: string): Dependency[];
export function depsFromCommits(commits: Commit[]): Dependency[];
export function judge(args: { deps: Dependency[], ecosystem: string, now: number, lookup: Lookup, hours?: number }): Promise<JudgeResult>;
export function exitCodeOf(result: JudgeResult): number;
export function realLookup(ecosystem: string, name: string, version: string): string | null;
