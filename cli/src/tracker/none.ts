// 課題管理を使わない project の adapter。記録は書かない。
import { TpmError } from '../skill-sets.ts';
import type { Tracker, TrackerIssue } from './types.ts';

/** 何もしない adapter。どの Key も自分の物としない。 */
export class NoneTracker implements Tracker {
  owns(): boolean {
    return false;
  }

  view(key: string): TrackerIssue {
    throw new TpmError(`課題管理の課題ではありません: ${key}`);
  }

  comment(): void {
    // 書かない。
  }

  close(): void {
    // 閉じる課題が無い。
  }
}
