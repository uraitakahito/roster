// NATS JetStream の adapter。配りの口を、NATS の stream と consumer に写す。NATS の言葉はこのファイルの外に出さない。
// 箱は 3 つ:
// - 記録の箱（stream。limits）: 置かれた物をみな残す。重なり除けの窓を持つ。
// - 配る箱（stream。workqueue）: 記録の箱から写しを受ける。渡せたと返った物は消える。届かないまま残った物は期限で消える。
// - 知らせの箱（stream。limits）: 渡し直しの上限を超えた時に NATS が出す知らせを溜める。
// 受け手ごとに、配る箱の上に取り口（durable の pull consumer）を作る。
import { AckPolicy, DeliverPolicy, DiscardPolicy, jetstream, JetStreamApiCodes, JetStreamApiError, jetstreamManager, RetentionPolicy, StorageType, type Consumer, type JetStreamClient, type JetStreamManager, type JsMsg, type StoredMsg } from '@nats-io/jetstream';
import { connect, headers, nanos, type NatsConnection } from '@nats-io/transport-node';
import { TpmError } from '../skill-sets.ts';
import { MAILROOM_LIMITS, type Counts, type Letter, type Mailroom, type MailroomLimits, type Recipient, type Stored, type TakeLimit, type Taken, type Undeliverable } from './types.ts';

/** NATS に 1 回聞く時の時間切れ（ミリ秒。plan-4 の T9）。 */
const REQUEST_TIMEOUT_MS = 2000;

/** 箱の名に入れる、project を分ける名（道具の名の 1 語に使える字だけにする）。 */
const token = (s: string): string => s.replaceAll(/[^A-Za-z0-9_-]/g, '_');

/** 受け手の名に使える形（そのまま道具の宛名と取り口の名にする。字を替えると、違う受け手が同じ名になりうるので、替えずに断る）。 */
const RECIPIENT = /^[A-Za-z0-9_-]{1,64}$/;

/** 受け手の名を確かめて返す。 */
function recipientName(to: Recipient): string {
  if (!RECIPIENT.test(to)) throw new TpmError(`受け手の名に使えない字があります（英数字と _ と - を 64 字まで）: ${to}`);
  return to;
}

/** 決めた時間で諦める（NATS が止まっている時に、返らない問いを待ち続けない）。 */
const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((resolve) => {
    setTimeout(resolve, ms, undefined).unref();
  })]);

/** 知らせの箱を読む取り口の名。 */
const ADVISORY_READER = 'roster-undeliverable';

/** NATS が出す「渡し直しの上限を超えた」の知らせの中身。 */
interface MaxDeliveriesAdvisory {
  timestamp: string
  stream: string
  consumer: string
  stream_seq: number
  deliveries: number
}

const MISSING: number[] = [JetStreamApiCodes.StreamNotFound, JetStreamApiCodes.ConsumerNotFound, JetStreamApiCodes.NoMessageFound];

/** 「無い」の誤りか（stream・consumer・message）。NATS の誤りの番号で見る（字では見ない）。 */
const missing = (e: unknown): boolean => e instanceof JetStreamApiError && MISSING.includes(e.code);

/** この口で取り置いた 1 通。 */
interface Held {
  to: Recipient
  msg: JsMsg
  /** 取り置きの期限（この口の時計。過ぎた物は、NATS が渡し直す物として数える）。 */
  until: number
}

/** NATS JetStream で配る adapter。space は、同じ NATS を使う project を分ける名（状態の folder の名）。 */
export class NatsMailroom implements Mailroom {
  private readonly url: string;
  private readonly space: string;
  private readonly limits: MailroomLimits;
  private nc?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;
  private ready = false;
  /** この口で取り置いた物（id → NATS のメッセージ）。渡せた・返すは、これにだけ効く。 */
  private readonly held = new Map<string, Held>();

  constructor(url: string, space: string, limits: MailroomLimits = MAILROOM_LIMITS) {
    this.url = url;
    this.space = token(space);
    this.limits = limits;
  }

  private get log(): string { return `roster-${this.space}-log`; }
  private get work(): string { return `roster-${this.space}-work`; }
  private get advisories(): string { return `roster-${this.space}-adv`; }
  private subject(to: Recipient): string { return `roster.${this.space}.msg.${recipientName(to)}`; }

  /** 繋ぎ、箱が無ければ作る（あれば作らない）。繋ぎと JetStream の口は、みな作れてから覚える（途中で落ちたら、繋ぎを閉じて何も覚えない）。 */
  private async open(): Promise<{ js: JetStreamClient, jsm: JetStreamManager }> {
    if (this.nc === undefined || this.js === undefined || this.jsm === undefined) {
      let nc: NatsConnection | undefined;
      try {
        // 繋ぎ直しはしない（短く生きる命令と hook が使う。切れたら誤りにして、呼ぶ側が口を作り直す）。
        nc = await connect({ servers: this.url, timeout: REQUEST_TIMEOUT_MS, reconnect: false, name: 'roster' });
        const js = jetstream(nc, { timeout: REQUEST_TIMEOUT_MS });
        const jsm = await jetstreamManager(nc, { timeout: REQUEST_TIMEOUT_MS });
        this.nc = nc;
        this.js = js;
        this.jsm = jsm;
      }
      catch (e) {
        await nc?.close().catch(() => undefined);
        throw new TpmError(`メッセージキュー（NATS。${this.url}）が応えません: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const { js, jsm } = this;
    if (!this.ready) {
      await this.ensureStreams(jsm);
      this.ready = true;
    }
    return { js, jsm };
  }

  private async ensureStreams(jsm: JetStreamManager): Promise<void> {
    const exists = async (name: string): Promise<boolean> => {
      try {
        await jsm.streams.info(name);
        return true;
      }
      catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    };
    // ほかの process が同時に作った時（同じ名で、作った時刻だけが違う設定になる）は、もうあるのを見て進む。
    const add = async (name: string, config: Parameters<JetStreamManager['streams']['add']>[0]): Promise<void> => {
      if (await exists(name)) return;
      try {
        await jsm.streams.add(config);
      }
      catch (e) {
        if (!await exists(name)) throw e;
      }
    };
    {
      await add(this.log, {
        name: this.log,
        subjects: [`roster.${this.space}.msg.>`],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        discard: DiscardPolicy.Old,
        max_age: nanos(this.limits.recordTtlMs),
        duplicate_window: nanos(this.limits.duplicateWindowMs),
        num_replicas: 1,
      });
    }
    {
      await add(this.work, {
        name: this.work,
        // 写しを受け始める位置を、作った時刻からにする。書かないと、作り直した時に記録の箱の中身をみな写し直し、届いた物まで渡り直す。
        sources: [{ name: this.log, opt_start_time: new Date().toISOString() }],
        retention: RetentionPolicy.Workqueue,
        // 箱の中を、取り置かずに読めるようにする（片付ける時と、まだ届いていない物を引く時）。
        allow_direct: true,
        storage: StorageType.File,
        discard: DiscardPolicy.Old,
        max_age: nanos(this.limits.undeliveredTtlMs),
        num_replicas: 1,
      });
    }
    {
      await add(this.advisories, {
        name: this.advisories,
        subjects: [`$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.${this.work}.>`],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        discard: DiscardPolicy.Old,
        max_age: nanos(this.limits.recordTtlMs),
        num_replicas: 1,
      });
    }
  }

  /** 受け手の取り口（無ければ作る）。 */
  private async consumer(to: Recipient): Promise<Consumer> {
    const { js, jsm } = await this.open();
    const name = recipientName(to);
    try {
      return await js.consumers.get(this.work, name);
    }
    catch (e) {
      if (!missing(e)) throw e;
    }
    // 同時に作っても、同じ設定なら NATS は同じ取り口を返す。
    await jsm.consumers.add(this.work, {
      durable_name: name,
      filter_subject: this.subject(to),
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      ack_wait: nanos(this.limits.holdMs),
      max_deliver: this.limits.maxDeliveries,
      max_ack_pending: this.limits.maxHeld,
    });
    return js.consumers.get(this.work, name);
  }

  async put(letter: Letter): Promise<{ duplicate: boolean }> {
    const { js } = await this.open();
    const h = headers();
    h.set('Roster-From', encodeURIComponent(letter.from));
    h.set('Roster-To', encodeURIComponent(letter.to));
    // 預かった時刻は、置く時に 1 度決めて持たせる（記録の箱と配る箱で、同じ時刻を返すため）。
    h.set('Roster-At', new Date().toISOString());
    if (letter.replyTo !== undefined) h.set('Roster-Reply-To', letter.replyTo);
    const ack = await js.publish(this.subject(letter.to), letter.text, { msgID: letter.id, headers: h });
    return { duplicate: ack.duplicate };
  }

  async counts(to: Recipient): Promise<Counts> {
    const info = await (await this.consumer(to)).info();
    return { waiting: info.num_pending, held: info.num_ack_pending };
  }

  async peek(to: Recipient): Promise<Stored[]> {
    return (await this.scan(this.subject(to))).map(m => this.fromStored(to, m));
  }

  take(to: Recipient, limit: TakeLimit): Promise<Taken[]> {
    return this.pull(to, limit, 0);
  }

  wait(to: Recipient, limit: TakeLimit, ms: number): Promise<Taken[]> {
    return this.pull(to, limit, ms);
  }

  /** 古い順に取り置く。waitMs が 0 なら、今ある物だけ（取り口の数を見てから取るので、無ければ待たない）。 */
  private async pull(to: Recipient, limit: TakeLimit, waitMs: number): Promise<Taken[]> {
    const consumer = await this.consumer(to);
    const out: Taken[] = [];
    let chars = 0;
    // NATS の「来るまで待つ」1 回は、短くても 1 秒。
    let expires = Math.max(1000, waitMs);
    for (;;) {
      if (out.length >= limit.max) break;
      if (waitMs === 0 || out.length > 0) {
        // 待たない取り方: まだ渡していない物も、渡し直す物（取り置き中の物。返された物・期限の切れた物を含む）も無ければ、聞かずに終わる。
        // 取り置き中の物がほかの口の手にある間は、ここで 1 秒待って空で返る（NATS の 1 回の問いは、短くても 1 秒）。
        const info = await consumer.info();
        // 自分がまだ取り置いている物（期限の内の物）は、渡し直されないので引く。期限を過ぎた物は、渡し直される物として残す。
        const now = Date.now();
        const mine = [...this.held.values()].filter(h => h.to === to && h.until > now).length;
        if (info.num_pending === 0 && info.num_ack_pending - mine <= 0) break;
        expires = 1000;
      }
      const m = await consumer.next({ expires });
      if (m === null) break;
      const taken = this.taken(to, m);
      if (out.length > 0 && chars + taken.text.length > limit.chars) {
        // 入りきらない 1 通は返す（次の回の頭で取る）。
        m.nak();
        break;
      }
      this.held.set(taken.id, { to, msg: m, until: Date.now() + this.limits.holdMs });
      out.push(taken);
      chars += taken.text.length;
    }
    return out;
  }

  private taken(to: Recipient, m: JsMsg): Taken {
    return { ...this.stored(to, m.headers?.get('Nats-Msg-Id') ?? '', m.string(), m.headers, m.time.toISOString()), deliveries: m.info.deliveryCount };
  }

  private stored(to: Recipient, id: string, text: string, h: { get(k: string): string } | undefined, at: string): Stored {
    const replyTo = h?.get('Roster-Reply-To') ?? '';
    const recipient = decodeURIComponent(h?.get('Roster-To') ?? '') || to;
    return { id, from: decodeURIComponent(h?.get('Roster-From') ?? ''), to: recipient, text, at: (h?.get('Roster-At') ?? '') || at, ...(replyTo === '' ? {} : { replyTo }) };
  }

  async done(taken: Taken[]): Promise<void> {
    for (const t of taken) {
      const h = this.held.get(t.id);
      if (h === undefined) throw new TpmError(`この口で取り置いていないメッセージです: ${t.id}`);
      // NATS が受け取ったのを確かめてから進む（返事が届かなければ誤りにする。渡せたと思い込まない）。
      if (!await h.msg.ackAck({ timeout: REQUEST_TIMEOUT_MS })) throw new TpmError(`メッセージキューが「渡せた」を受けませんでした: ${t.id}`);
      this.held.delete(t.id);
    }
  }

  async giveBack(taken: Taken[]): Promise<void> {
    for (const t of taken) {
      const h = this.held.get(t.id);
      if (h === undefined) continue;
      h.msg.nak();
      this.held.delete(t.id);
    }
    // 返したのが NATS に届くのを、決めた時間だけ待つ（届かなくても、取り置きの期限で外れる）。
    if (this.nc !== undefined && !this.nc.isClosed()) await within(this.nc.flush().catch(() => undefined), REQUEST_TIMEOUT_MS);
  }

  async undeliverable(): Promise<Undeliverable[]> {
    const { js, jsm } = await this.open();
    try {
      await js.consumers.get(this.advisories, ADVISORY_READER);
    }
    catch (e) {
      if (!missing(e)) throw e;
      await jsm.consumers.add(this.advisories, { durable_name: ADVISORY_READER, ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All });
    }
    const reader = await js.consumers.get(this.advisories, ADVISORY_READER);
    const out: Undeliverable[] = [];
    while ((await reader.info()).num_pending > 0) {
      const m = await reader.next({ expires: 1000 });
      if (m === null) break;
      const a = m.json<MaxDeliveriesAdvisory>();
      const kept = await this.message(jsm, this.work, a.stream_seq);
      const to = kept === undefined ? a.consumer : decodeURIComponent(kept.header.get('Roster-To')) || a.consumer;
      out.push({ to, deliveries: a.deliveries, at: a.timestamp, ...(kept === undefined ? {} : { stored: this.fromStored(to, kept) }) });
      // 元の物は配る箱に残っているので消す（残すと、取り口を作り直した時にまた渡る）。
      if (kept !== undefined) {
        await jsm.streams.deleteMessage(this.work, a.stream_seq).catch((e: unknown) => {
          // 読んでから消すまでの間に、期限で消えていた時は、消せた扱いにする。
          if (!missing(e)) throw e;
        });
      }
      await m.ackAck({ timeout: REQUEST_TIMEOUT_MS });
    }
    return out;
  }

  private async message(jsm: JetStreamManager, stream: string, seq: number): Promise<StoredMsg | undefined> {
    try {
      return await jsm.streams.getMessage(stream, { seq }) ?? undefined;
    }
    catch (e) {
      if (missing(e)) return undefined;
      throw e;
    }
  }

  private fromStored(to: Recipient, m: StoredMsg): Stored {
    return this.stored(to, m.header.get('Nats-Msg-Id'), m.string(), m.header, m.time.toISOString());
  }

  /** 配る箱の中の物を、古い順に読む（取り置かない。渡した回数にも数えない）。filter は宛名。 */
  private async scan(filter: string): Promise<StoredMsg[]> {
    const { jsm } = await this.open();
    const out: StoredMsg[] = [];
    for (let seq = 1; ;) {
      let m: StoredMsg | null;
      try {
        m = await jsm.direct.getMessage(this.work, { seq, next_by_subj: filter });
      }
      catch (e) {
        if (missing(e)) break;
        throw e;
      }
      if (m === null) break;
      out.push(m);
      seq = m.seq + 1;
    }
    return out;
  }

  async clear(to: Recipient): Promise<Stored[]> {
    const { jsm } = await this.open();
    const kept = await this.scan(this.subject(to));
    try {
      await jsm.consumers.delete(this.work, recipientName(to));
    }
    catch (e) {
      if (!missing(e)) throw e;
    }
    // 消すのは、読んだ物まで（読んだ後に置かれた物は残す。返す物に入っていない物を、黙って消さない）。
    const last = kept.at(-1);
    if (last !== undefined) await jsm.streams.purge(this.work, { filter: this.subject(to), seq: last.seq + 1 });
    return kept.map(m => this.fromStored(to, m));
  }

  async recipients(): Promise<Recipient[]> {
    const { jsm } = await this.open();
    const names: string[] = [];
    for await (const c of jsm.consumers.list(this.work)) if (c.config.durable_name !== undefined) names.push(c.config.durable_name);
    return names;
  }

  async record(since: Date): Promise<Stored[]> {
    const { js, jsm } = await this.open();
    if ((await jsm.streams.info(this.log)).state.messages === 0) return [];
    // 記録の箱は、取り置かずに順に読む（読むだけの、消える取り口）。
    const reader = await js.consumers.get(this.log, { deliver_policy: DeliverPolicy.StartTime, opt_start_time: since.toISOString() });
    const out: Stored[] = [];
    try {
      for (;;) {
        const m = await reader.next({ expires: 1000 });
        if (m === null) break;
        out.push(this.stored('', m.headers?.get('Nats-Msg-Id') ?? '', m.string(), m.headers, m.time.toISOString()));
        if (m.info.pending === 0) break;
      }
    }
    finally {
      await reader.delete().catch(() => false);
    }
    return out;
  }

  async outstanding(): Promise<Set<string>> {
    return new Set((await this.scan(`roster.${this.space}.msg.>`)).map(m => m.header.get('Nats-Msg-Id')));
  }

  async lag(): Promise<number> {
    const { jsm } = await this.open();
    return (await jsm.streams.info(this.work)).sources?.reduce((a, s) => a + s.lag, 0) ?? 0;
  }

  async close(): Promise<void> {
    const nc = this.nc;
    delete this.nc;
    delete this.js;
    delete this.jsm;
    this.ready = false;
    if (nc === undefined) return;
    if (!nc.isClosed()) {
      for (const h of this.held.values()) h.msg.nak();
      // 送りかけの物を流してから閉じるのを、決めた時間だけ待つ。NATS が止まっていれば諦めて閉じる。
      await within(nc.drain().catch(() => undefined), REQUEST_TIMEOUT_MS);
    }
    this.held.clear();
    if (!nc.isClosed()) await within(nc.close().catch(() => undefined), REQUEST_TIMEOUT_MS);
  }
}
