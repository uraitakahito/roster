// 試験用の配りの口。NATS の adapter（nats.ts）と同じ振る舞いを、memory の上で、渡された時計で動かす。
// 同じ振る舞いであることは、2 つの adapter に同じ試験（test/mailroom-contract.ts）を流して確かめる。
import { TpmError } from '../skill-sets.ts';
import { MAILROOM_LIMITS, type Counts, type Letter, type Mailroom, type MailroomLimits, type Recipient, type Stored, type TakeLimit, type Taken, type Undeliverable } from './types.ts';

/** 配る箱の 1 通。deliveries は渡した回数、heldUntil は取り置きの期限（ミリ秒の時刻）。 */
export interface Item {
  stored: Stored
  deliveries: number
  heldUntil: number
  /** 渡し直しの上限を超えた（もう渡さない。undeliverable() が片付けるまで箱に残る）。 */
  dead: boolean
}

/** 預かる側（NATS の server に当たる）。口（MemoryMailroom）をいくつ作っても、これを 1 つ共有する。 */
export class MemoryPostOffice {
  /** 記録の箱。 */
  readonly log: Stored[] = [];
  /** 配る箱（置いた順）。 */
  work: Item[] = [];
  /** 上限を超えた知らせ（まだ引かれていない物）。 */
  advisories: Undeliverable[] = [];
  /** 重なり除けの窓の中の id → 置いた時刻。 */
  readonly recent = new Map<string, number>();
  /** 取り口のある受け手。 */
  readonly consumers = new Set<Recipient>();
  /** 段取りの値。 */
  readonly limits: MailroomLimits;
  /** 今の時刻（試験が進める時計）。 */
  readonly now: () => Date;

  constructor(now: () => Date, limits: MailroomLimits = MAILROOM_LIMITS) {
    this.now = now;
    this.limits = limits;
  }

  /** 期限で消える物を消す（届かないまま残った物・古い記録・窓を過ぎた id）。聞かれるたびに、時刻と比べて決める。 */
  sweep(): number {
    const now = this.now().getTime();
    this.work = this.work.filter(i => Date.parse(i.stored.at) + this.limits.undeliveredTtlMs > now);
    for (let i = this.log.length - 1; i >= 0; i--) if (Date.parse(this.log[i]?.at ?? '') + this.limits.recordTtlMs <= now) this.log.splice(i, 1);
    for (const [id, at] of this.recent) if (at + this.limits.duplicateWindowMs <= now) this.recent.delete(id);
    return now;
  }
}

/** memory の上の配りの口。同じ MemoryPostOffice を渡した口どうしは、同じ箱を見る（別々の process に当たる）。 */
export class MemoryMailroom implements Mailroom {
  private readonly office: MemoryPostOffice;
  /** この口で取り置いた物（id → 箱の 1 通）。 */
  private readonly held = new Map<string, Item>();

  constructor(office: MemoryPostOffice) {
    this.office = office;
  }

  put(letter: Letter): Promise<{ duplicate: boolean }> {
    const now = this.office.sweep();
    if (this.office.recent.has(letter.id)) return Promise.resolve({ duplicate: true });
    this.office.recent.set(letter.id, now);
    const stored: Stored = { ...letter, at: new Date(now).toISOString() };
    this.office.log.push(stored);
    this.office.work.push({ stored, deliveries: 0, heldUntil: 0, dead: false });
    return Promise.resolve({ duplicate: false });
  }

  /** その受け手の、まだ渡す物（上限を超えた物を除く）。 */
  private live(to: Recipient): Item[] {
    this.office.sweep();
    this.office.consumers.add(to);
    return this.office.work.filter(i => i.stored.to === to && !i.dead);
  }

  counts(to: Recipient): Promise<Counts> {
    const items = this.live(to);
    return Promise.resolve({ waiting: items.filter(i => i.deliveries === 0).length, held: items.filter(i => i.deliveries > 0).length });
  }

  take(to: Recipient, limit: TakeLimit): Promise<Taken[]> {
    const now = this.office.now().getTime();
    const { holdMs, maxDeliveries, maxHeld } = this.office.limits;
    const out: Taken[] = [];
    let chars = 0;
    for (;;) {
      if (out.length >= limit.max) break;
      const items = this.live(to);
      // 渡し直す物（取り置きの期限が切れた物）が先。上限に達していれば、渡さずに知らせを出す。
      const expired = items.find(i => i.deliveries > 0 && i.heldUntil <= now);
      if (expired !== undefined && expired.deliveries >= maxDeliveries) {
        expired.dead = true;
        this.office.advisories.push({ to, deliveries: expired.deliveries, at: new Date(now).toISOString(), stored: expired.stored });
        continue;
      }
      const fresh = items.filter(i => i.deliveries > 0 && i.heldUntil > now).length < maxHeld ? items.find(i => i.deliveries === 0) : undefined;
      const next = expired ?? fresh;
      if (next === undefined) break;
      if (out.length > 0 && chars + next.stored.text.length > limit.chars) {
        // 入りきらない 1 通は返す（渡した 1 度には数える。NATS と同じ）。
        next.deliveries += 1;
        next.heldUntil = now;
        break;
      }
      next.deliveries += 1;
      next.heldUntil = now + holdMs;
      this.held.set(next.stored.id, next);
      out.push({ ...next.stored, deliveries: next.deliveries });
      chars += next.stored.text.length;
    }
    return Promise.resolve(out);
  }

  /** 試験用の口は待たない（今ある物を取るだけ）。待つ動きは、本物の NATS に向けた試験で見る。 */
  wait(to: Recipient, limit: TakeLimit): Promise<Taken[]> {
    return this.take(to, limit);
  }

  done(taken: Taken[]): Promise<void> {
    for (const t of taken) {
      const item = this.held.get(t.id);
      if (item === undefined) return Promise.reject(new TpmError(`この口で取り置いていないメッセージです: ${t.id}`));
      this.office.work = this.office.work.filter(i => i !== item);
      this.held.delete(t.id);
    }
    return Promise.resolve();
  }

  giveBack(taken: Taken[]): Promise<void> {
    for (const t of taken) {
      const item = this.held.get(t.id);
      if (item === undefined) continue;
      item.heldUntil = this.office.now().getTime();
      this.held.delete(t.id);
    }
    return Promise.resolve();
  }

  undeliverable(): Promise<Undeliverable[]> {
    this.office.sweep();
    const out = this.office.advisories;
    this.office.advisories = [];
    this.office.work = this.office.work.filter(i => !i.dead);
    return Promise.resolve(out);
  }

  clear(to: Recipient): Promise<Stored[]> {
    this.office.sweep();
    const left = this.office.work.filter(i => i.stored.to === to).map(i => i.stored);
    this.office.work = this.office.work.filter(i => i.stored.to !== to);
    this.office.consumers.delete(to);
    return Promise.resolve(left);
  }

  recipients(): Promise<Recipient[]> {
    return Promise.resolve([...this.office.consumers]);
  }

  record(since: Date): Promise<Stored[]> {
    this.office.sweep();
    return Promise.resolve(this.office.log.filter(s => s.at >= since.toISOString()));
  }

  outstanding(): Promise<Set<string>> {
    this.office.sweep();
    return Promise.resolve(new Set(this.office.work.map(i => i.stored.id)));
  }

  lag(): Promise<number> {
    return Promise.resolve(0);
  }

  close(): Promise<void> {
    for (const item of this.held.values()) item.heldUntil = this.office.now().getTime();
    this.held.clear();
    return Promise.resolve();
  }
}
