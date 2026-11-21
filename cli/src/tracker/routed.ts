// 課題の Key の形で道具を選ぶ adapter。設定は project の folder とその直下の folder の物を合わせるので、道具は 1 つに決まらない。
// Jira の形（AI-12）は、jira を宣言した設定が 1 つでもあれば Jira。gh- の形は、github を宣言した設定の folder の repo。
// どの設定も宣言していない道具の Key と t- の Key は持たない（記録を書かない）。
import type { ConfigSource, RecordingTracker, RolesConfig } from '../config.ts';
import type { Exec } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import { GithubTracker } from './github.ts';
import { JiraTracker } from './jira.ts';
import type { Note, Tracker, TrackerIssue } from './types.ts';

/** Key の記録の先: 道具と、それを宣言した設定。 */
export interface Route {
  tool: RecordingTracker
  source: ConfigSource
}

/**
 * Key の記録の先を選ぶ。記録の先が無い Key なら undefined。
 * github を宣言した設定が 2 つ以上あると、gh- の Key がどの repo の Issue かが決まらないので止まる。
 */
export function route(trackers: RolesConfig['trackers'], exec: Exec, key: string): Route | undefined {
  const [jira] = trackers.jira;
  if (jira !== undefined && new JiraTracker(exec).owns(key)) return { tool: 'jira', source: jira };
  const [github, ...more] = trackers.github;
  if (github === undefined || !new GithubTracker(exec, github.dir).owns(key)) return undefined;
  if (more.length > 0) {
    throw new TpmError(`${key} がどの repo の Issue かが決まりません。"tracker": "github" の設定が 2 つ以上あります（${trackers.github.map(s => s.file).join('・')}）。起こした folder の設定の folders で、github の設定を 1 つに絞ってください`);
  }
  return { tool: 'github', source: github };
}

/** 合わせた設定の課題管理。Key ごとに、route が選んだ道具の adapter に渡す。 */
export class RoutedTracker implements Tracker {
  private readonly trackers: RolesConfig['trackers'];
  private readonly exec: Exec;

  constructor(trackers: RolesConfig['trackers'], exec: Exec) {
    this.trackers = trackers;
    this.exec = exec;
  }

  /** 記録を書く先がある Key か。 */
  owns(key: string): boolean {
    return route(this.trackers, this.exec, key) !== undefined;
  }

  view(key: string): TrackerIssue {
    return this.pick(key).view(key);
  }

  comment(key: string, note: Note): void {
    this.pick(key).comment(key, note);
  }

  close(key: string): void {
    this.pick(key).close(key);
  }

  private pick(key: string): Tracker {
    const to = route(this.trackers, this.exec, key);
    if (to === undefined) throw new TpmError(`課題管理の課題ではありません: ${key}`);
    return to.tool === 'jira' ? new JiraTracker(this.exec) : new GithubTracker(this.exec, to.source.dir);
  }
}
