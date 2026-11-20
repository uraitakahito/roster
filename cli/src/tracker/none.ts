// 課題管理を使わない project の adapter。記録は書かない。
import type { Tracker, TrackerComment } from './types.ts';

export class NoneTracker implements Tracker {
  owns(): boolean {
    return false;
  }

  comment(): void {
    // 書かない。
  }

  comments(): TrackerComment[] {
    return [];
  }

  close(): void {
    // 閉じる課題が無い。
  }
}
