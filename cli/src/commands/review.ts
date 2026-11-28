// roster review list: レビューの頼みと判定を、数で読む（reviews.ts の記録）。読むだけなので、どの担当も打てる。
import type { Command } from 'commander';
import { createContext, type Context } from '../context.ts';
import { readReviews, VERDICTS, type Review, type Verdict } from '../reviews.ts';
import { envOf } from '../env.ts';
import { checkoutPull, prunePlaces, removePlace, reviewGit } from '../review-place.ts';
import { ensureImage, REVIEW_IMAGES, reviewRun, reviewServe, reviewStop, type ReviewImage, type RunOptions } from '../review-run.ts';
import { isStaffKey, readRole, repoSeatKeys, staffKey, subjectOfStaffKey } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';

/** 時刻の字（ISO）を、月日と時分にする。 */
const short = (iso: string): string => iso.slice(5, 16).replace('T', ' ');
const minutes = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 60000);

/** 頼み 1 件の行。 */
function line(ctx: Context, r: Review): string {
  // 見る席: repo の席の頼みは親の課題の Tech Lead 担当、ほかは、その課題の Staff Engineer 担当の席。
  const seat = r.reviewer === 'tech-lead' ? (r.lead === undefined ? undefined : readRole(ctx, r.lead)) : readRole(ctx, staffKey(r.key));
  const lead = r.reviewer === 'tech-lead';
  // 渡した回と席の今の回が違えば、頼みは前の回の受け箱に届いたまま（Tech Lead 担当は、今の回の roster hello が並べる）。
  const earlier = seat !== undefined && r.launch !== undefined && seat.launch !== r.launch;
  const waiting = r.brief === undefined
    ? '席に渡していない'
    : seat === undefined
      ? '渡したが、席がもう無い'
      : earlier
        ? (lead ? '前の回の Tech Lead 担当に渡した。今の回には roster hello が並べる' : '前の回の席に渡した')
        : lead ? 'Tech Lead 担当が見ている' : '席が見ている';
  const state = `${r.verdict !== undefined ? VERDICTS[r.verdict] : `まだ（${waiting}）`}${r.escalatedAt === undefined ? '' : '・TPM 担当に上げた'}`;
  const when = `${short(r.askedAt)} に頼んだ${r.reviewedAt === undefined ? '' : `・${minutes(r.askedAt, r.reviewedAt)} 分で返った`}`;
  return [`#${r.n}`, r.key, state, r.url, when, ...(r.page === undefined ? [] : [r.page])].join('  ');
}

/** since より後に、結果のページ（result-N.html）を載せた【done】を出した課題の Key。 */
function resultKeys(ctx: Context, since: string): string[] {
  const done = ctx.state.lines<{ at: string, key: string, heading: string, text: string }>('log.jsonl').filter(l => l.at >= since && l.heading === 'done' && /\/result-[1-9]\d*\.html/.test(l.text));
  return [...new Set(done.map(l => l.key))];
}

/**
 * レビューの頼みごとの行（課題・判定・見る物・頼んでから返るまでの時間・レビューのページ）と、合わせた数。
 * 終わりに、初めての頼みより後に結果の【done】を出した課題のうち、レビューを 1 度も頼んでいない課題を数える（頼む時を見直す材料。
 * レビューの仕組みが入る前の課題は数えない）。key があれば、その課題の頼みだけ。
 */
export function reviewList(ctx: Context, options: { key?: string }): string[] {
  const all = readReviews(ctx);
  // 課題の Key で絞ると、その課題の Tech Lead 担当が起こした repo の席（閉じた席も）の頼みも出す。
  const keys = options.key === undefined ? undefined : new Set([options.key, ...repoSeatKeys(ctx, options.key)]);
  const reviews = keys === undefined ? all : all.filter(r => keys.has(r.key));
  if (reviews.length === 0) return [options.key === undefined ? 'レビューの頼みは無い' : `${options.key} のレビューの頼みは無い`];
  const count = (v: Verdict): number => reviews.filter(r => r.verdict === v).length;
  const counts = (Object.keys(VERDICTS) as Verdict[]).map(v => `${VERDICTS[v]} ${count(v)}`).join('・');
  const lines = [...reviews.map(r => line(ctx, r)), `頼み ${reviews.length} 件: ${counts}・まだ ${reviews.filter(r => r.verdict === undefined).length}・TPM 担当に上げた ${reviews.filter(r => r.escalatedAt !== undefined).length}`];
  if (options.key !== undefined) return lines;
  const asked = new Set(all.map(r => r.key));
  const results = resultKeys(ctx, all[0]?.askedAt ?? '');
  const without = results.filter(k => !asked.has(k));
  return [...lines, `結果の【done】を出した課題 ${results.length} 件のうち、レビューを頼んでいない課題: ${without.length} 件${without.length === 0 ? '' : `（${without.join('・')}）`}`];
}

/** `roster review` の命令を命令の木に足す。 */
export function registerReview(program: Command, print: (lines: string[]) => void): void {
  const review = program.command('review').description('レビューの頼みと判定を読む（頼むのは roster ask review、返すのは roster report review）');
  review.command('list').description('頼みごとの行と、合わせた数（頼んだ回数・判定ごとの数・レビューを頼んでいない課題）')
    .option('--key <Key>', 'その課題の頼みだけ')
    .action((options: { key?: string }) => print(reviewList(createContext(), options)));
  // レビューの席の自分の場所（t-n4j9 の段 2。review-place.ts）。
  review.command('checkout <url>').description('課題のレビューの場所に、PR の head を出す（clone が無ければ作る。見直しでは新しい head に替える）')
    .action((url: string) => {
      const ctx = createContext();
      const { tree, head } = checkoutPull(ctx, placeKey(ctx), url);
      print([`PR の head を出した: ${tree}（${head.slice(0, 7)}）`]);
    });
  review.command('git <args...>').description('レビューの場所の clone（--main なら project の本体）を、読むだけの git で読む（roster review git -- log --oneline -3）')
    .option('--repo <名>', 'clone が 2 つ以上ある時の repo の名')
    .option('--main <名>', 'project の folder の直下の、その名の本体を読む')
    .action((args: string[], options: { repo?: string, main?: string }) => {
      const ctx = createContext();
      const r = reviewGit(ctx, placeKey(ctx), options, args);
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      process.exit(r.status);
    });
  // 使い捨ての container で流す（t-n4j9 の段 3。review-run.ts）。
  const runOptions = (c: Command): Command => c
    .option('--repo <名>', 'clone が 2 つ以上ある時の repo の名')
    .option('--image <種類>', `image の種類（${Object.keys(REVIEW_IMAGES).join('・')}。既定は作業の木の file で決める）`)
    .option('--memory <量>', 'container のメモリ（既定 4G）');
  const opts = (o: { repo?: string, image?: string, memory?: string }): RunOptions => ({
    ...(o.repo === undefined ? {} : { repo: o.repo }),
    ...(o.image === undefined ? {} : { image: imageOption(o.image) }),
    ...(o.memory === undefined ? {} : { memory: o.memory }),
  });
  runOptions(review.command('run <command...>').description('レビューの場所の clone を、使い捨ての container の中で試す（roster review run -- pnpm test）。mount は作業の木と課題の cache だけ'))
    .action((command: string[], o: { repo?: string, image?: string, memory?: string }) => {
      const ctx = createContext();
      const r = reviewRun(ctx, placeKey(ctx), opts(o), command);
      print(r.lines);
      process.exit(r.status);
    });
  runOptions(review.command('serve <command...>').description('container を起こしたままにして、名と IP を出す（動かして試す。止めるのは roster review stop）'))
    .action((command: string[], o: { repo?: string, image?: string, memory?: string }) => {
      const ctx = createContext();
      print(reviewServe(ctx, placeKey(ctx), opts(o), command));
    });
  review.command('stop [name]').description('この課題の container を止める（名を書かなければ、みな）')
    .action((name: string | undefined) => {
      const ctx = createContext();
      const stopped = reviewStop(ctx, placeKey(ctx), name);
      print(stopped.length === 0 ? ['止める container は無い'] : stopped.map(n => `止めた: ${n}`));
    });
  review.command('build [kind]').description('レビューの container の image を作る（無ければ。既定はみな）')
    .action((kind: string | undefined) => {
      const ctx = createContext();
      const kinds = kind === undefined ? Object.keys(REVIEW_IMAGES) as ReviewImage[] : [imageOption(kind) as ReviewImage];
      const out = kinds.flatMap(k => ensureImage(ctx, k));
      print(out.length === 0 ? ['image はもうある'] : out);
    });
  review.command('clean [key]').description('課題のレビューの場所を消す（Key を書かなければ、名簿に居ない課題の場所のうち 1 時間より古い物）')
    .action((key: string | undefined) => {
      const ctx = createContext();
      if (key !== undefined) {
        const removed = removePlace(ctx, key);
        print([removed === undefined ? `${key} のレビューの場所は無い` : `消した: ${removed}`]);
        return;
      }
      const removed = prunePlaces(ctx, k => readRole(ctx, staffKey(k)) !== undefined);
      print(removed.length === 0 ? ['消す場所は無い'] : removed.map(p => `消した: ${p}`));
    });
}

/** --image の値を確かめる。 */
function imageOption(value: string | undefined): ReviewImage | undefined {
  if (value === undefined) return undefined;
  if (!(value in REVIEW_IMAGES)) throw new TpmError(`--image は ${Object.keys(REVIEW_IMAGES).join('・')} のどれか: ${value}`);
  return value as ReviewImage;
}

/** 打った担当の、レビューの場所の Key（Staff Engineer 担当の席なら、見ている課題の Key）。 */
function placeKey(ctx: Context): string {
  const key = envOf(ctx.env, 'KEY');
  if (key === undefined) throw new TpmError('レビューの場所は、課題の担当と Staff Engineer 担当の席から使います（$ROSTER_KEY がありません）');
  return isStaffKey(key) ? subjectOfStaffKey(key) : key;
}
