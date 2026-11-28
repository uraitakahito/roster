// レビューの席が、試験・build・動かして試す手を、使い捨ての container の中だけで流す（t-n4j9 の段 3。監査 audit-2 の R14）。
// container に見せるのは、課題の場所の作業の木（/work）と、課題ごとの cache（/cache・cargo の取り込み物）だけ。git の folder・課題の担当の worktree・
// 本体・home は見えない。network は専用の roster-review（段 0 の 5: default の container（置き場・NATS・builder）と手元の口に届かず、
// npm・crates.io・GitHub には届く）。cache は課題の席どうしで共有しない（段 0 の 7: Apple の container の volume は同時に 2 つに付かず、
// host の folder の共有は cargo の lock が効かずに落ちた）。
// container の命令は、名を字で書いて打つ（roster-review- の頭。共有の環境の決まり）。prune・system は使わない。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from './context.ts';
import { clonedRepos, placeDir, workTree } from './review-place.ts';
import { shellQuote } from './shell.ts';
import { TpmError } from './skill-sets.ts';

/** レビューの container が使う network の名。 */
export const REVIEW_NETWORK = 'roster-review';
/** container の名の頭（共有の環境の宣言 review の match と同じ）。 */
export const REVIEW_PREFIX = 'roster-review-';
/** 既定のメモリ（段 0 の 4: castlist の clippy と試験は 4 GB で足り、8 GB と差が小さい）。 */
export const REVIEW_MEMORY = '4G';
/** 画面に出す出力の末の行の数（全部は場所の logs/ に置く）。 */
const TAIL = 40;

/** image の種類と Containerfile の名。 */
export const REVIEW_IMAGES = { node: 'node.Containerfile', rust: 'rust.Containerfile' } as const;
/** image の種類。 */
export type ReviewImage = keyof typeof REVIEW_IMAGES;

/** image の名（Containerfile の中身の hash を版にする。中身が替われば、次に流す時に作り直す）。 */
export function imageName(ctx: Context, kind: ReviewImage): string {
  const file = join(ctx.root, 'review', 'images', REVIEW_IMAGES[kind]);
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
  return `roster-review-${kind}:${hash}`;
}

/**
 * 作業の木の file から、image の種類を決める。一番上に Cargo.toml があれば rust、package.json があれば node。
 * 一番上に無ければ、1 つ下の folder を見る（roster の cli/・docs-site/ のように、一番上に package.json を置かない repo）。rust の image は node も持つので、rust を先に見る。
 */
export function imageFor(tree: string): ReviewImage | undefined {
  const dirs = [tree, ...readdirSync(tree, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== 'target').map(d => join(tree, d.name))];
  for (const [file, kind] of [['Cargo.toml', 'rust'], ['package.json', 'node']] as const) {
    if (existsSync(join(tree, file))) return kind;
  }
  for (const [file, kind] of [['Cargo.toml', 'rust'], ['package.json', 'node']] as const) {
    if (dirs.slice(1).some(d => existsSync(join(d, file)))) return kind;
  }
  return undefined;
}

/** container の命令を打つ。しくじれば訳を出して止まる。 */
function container(ctx: Context, args: string[], what: string): string {
  const r = ctx.exec('container', args);
  if (r.status !== 0) throw new TpmError(`${what}に失敗しました: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/** image が無ければ作る（builder は container build がそのまま使う。-c・-m・--ssh・--dns は付けない。共有の環境の決まり）。作った時は出す行。 */
export function ensureImage(ctx: Context, kind: ReviewImage): string[] {
  const name = imageName(ctx, kind);
  const listed = ctx.exec('container', ['image', 'inspect', name]);
  if (listed.status === 0) return [];
  const dir = join(ctx.root, 'review', 'images');
  container(ctx, ['build', '--tag', name, '--file', join(dir, REVIEW_IMAGES[kind]), dir], `image ${name} を作るの`);
  return [`image を作った: ${name}`];
}

/** 専用の network が無ければ作る（宣言 review の手続きは自由。消すのは名を書いた container network delete roster-review）。 */
export function ensureNetwork(ctx: Context): string[] {
  if (ctx.exec('container', ['network', 'inspect', REVIEW_NETWORK]).status === 0) return [];
  container(ctx, ['network', 'create', '--label', 'roster=review', REVIEW_NETWORK], `network ${REVIEW_NETWORK} を作るの`);
  return [`network を作った: ${REVIEW_NETWORK}`];
}

/** 流す物の選び。 */
export interface RunOptions {
  repo?: string
  image?: ReviewImage
  memory?: string
}

/** 課題の場所の clone から、流す repo の作業の木を選ぶ。 */
function chooseTree(ctx: Context, key: string, repo: string | undefined): { repo: string, tree: string } {
  const repos = clonedRepos(ctx, key);
  const name = repo ?? (repos.length === 1 ? repos[0] : undefined);
  if (name === undefined) throw new TpmError(repos.length === 0 ? 'この課題の場所に clone がありません（roster review checkout <PR の URL> で作る）' : `clone が ${repos.length} つあります。--repo <名> で選んでください: ${repos.join('・')}`);
  if (!repos.includes(name)) throw new TpmError(`この課題の場所に ${name} の clone がありません: ${repos.join('・') || '（無し）'}`);
  return { repo: name, tree: workTree(ctx, key, name) };
}

/** 引数を、container の中の sh -c の字にする（1 つなら、そのまま shell の字として読む）。 */
const script = (command: string[]): string => command.length === 1 ? command[0] ?? '' : command.map(shellQuote).join(' ');

/** 命令の名（Key の字は名に使える字だけ。placeDir が確かめた物）。 */
const nameOf = (key: string, kind: string, ctx: Context): string => `${REVIEW_PREFIX}${key.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${kind}-${ctx.now().getTime().toString(36)}`;

/**
 * container run の引数。mount は作業の木（/work）と、課題ごとの cache（/cache と cargo の取り込み物）だけ。
 * --network は専用の network、-m はその container だけに効く（共有の環境の決まりが止めるのは build の -c・-m）。
 */
export function runArgs(ctx: Context, key: string, tree: string, image: string, options: { name: string, memory: string, detach: boolean, command: string[] }): string[] {
  const cache = join(placeDir(ctx, key), 'cache');
  return [
    'run',
    '--rm',
    ...(options.detach ? ['--detach'] : []),
    '--name',
    options.name,
    '--network',
    REVIEW_NETWORK,
    '--memory',
    options.memory,
    '--volume',
    `${tree}:/work`,
    '--volume',
    `${cache}:/cache`,
    '--volume',
    `${join(cache, 'cargo', 'cache')}:/usr/local/cargo/registry/cache`,
    '--volume',
    `${join(cache, 'cargo', 'index')}:/usr/local/cargo/registry/index`,
    '--workdir',
    '/work',
    image,
    'sh',
    '-c',
    script(options.command),
  ];
}

/** 用意（作業の木・image・network・cache の folder）をそろえ、run の材料を返す。 */
function prepare(ctx: Context, key: string, options: RunOptions): { tree: string, image: string, lines: string[] } {
  const { tree } = chooseTree(ctx, key, options.repo);
  const kind = options.image ?? imageFor(tree);
  if (kind === undefined) throw new TpmError(`${tree} の言語が分かりません（Cargo.toml も package.json も無い）。--image node か --image rust で名指してください`);
  const cache = join(placeDir(ctx, key), 'cache');
  for (const dir of [join(cache, 'pnpm'), join(cache, 'cargo', 'cache'), join(cache, 'cargo', 'index'), join(placeDir(ctx, key), 'logs')]) mkdirSync(dir, { recursive: true });
  const lines = [...ensureNetwork(ctx), ...ensureImage(ctx, kind)];
  return { tree, image: imageName(ctx, kind), lines };
}

/** 課題ごとの lock（同じ課題の中で 2 つの run を同時に流さない。cache の lock は VM をまたいで効かないため）。 */
function withLock<T>(ctx: Context, key: string, run: () => T): T {
  const lock = join(placeDir(ctx, key), 'run.lock');
  try {
    mkdirSync(lock);
  }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    throw new TpmError(`この課題の container がもう流れています（${lock}）。終わってから打ち直してください（落ちて残っていれば、その folder を消す）`);
  }
  try {
    return run();
  }
  finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * 命令を、使い捨ての container の中で流す。出力の全部を場所の logs/ に置き、画面には末の行と置き場所を出す。終了コードは命令の物。
 */
export function reviewRun(ctx: Context, key: string, options: RunOptions, command: string[]): { lines: string[], status: number } {
  if (command.length === 0) throw new TpmError('-- の後に、container の中で流す命令を書いてください（roster review run -- pnpm test）');
  // clone を先に確かめる（場所が無い課題で、lock の folder を作れない誤りを「流れています」と読み違えない）。
  chooseTree(ctx, key, options.repo);
  return withLock(ctx, key, () => {
    const { tree, image, lines } = prepare(ctx, key, options);
    const name = nameOf(key, 'run', ctx);
    const r = ctx.exec('container', runArgs(ctx, key, tree, image, { name, memory: options.memory ?? REVIEW_MEMORY, detach: false, command }));
    const log = join(placeDir(ctx, key), 'logs', `${name}.log`);
    const all = `${r.stdout}${r.stderr}`;
    writeFileSync(log, all);
    const tail = all.split('\n').filter(l => !/^\[\d\/\d\] /.test(l)).slice(-TAIL);
    return { lines: [...lines, ...tail, `終了コード ${r.status}・全部の出力: ${log}`], status: r.status };
  });
}

/** 動かして試す: container を起こしたままにし、名と IP を出す（手元から container の IP で届く。段 0 の 8）。 */
export function reviewServe(ctx: Context, key: string, options: RunOptions, command: string[]): string[] {
  if (command.length === 0) throw new TpmError('-- の後に、container の中で起こす命令を書いてください（roster review serve -- pnpm start）');
  const { tree, image, lines } = prepare(ctx, key, options);
  const name = nameOf(key, 'serve', ctx);
  container(ctx, runArgs(ctx, key, tree, image, { name, memory: options.memory ?? REVIEW_MEMORY, detach: true, command }), `${name} を起こすの`);
  return [...lines, `起こした: ${name}（IP: ${ipOf(ctx, name) ?? '読めない'}）。止めるのは roster review stop ${name}`];
}

/** container の IP（container ls の 6 つ目の欄）。読めなければ undefined。 */
function ipOf(ctx: Context, name: string): string | undefined {
  const r = ctx.exec('container', ['ls']);
  const row = r.stdout.split('\n').map(l => l.trim().split(/\s+/)).find(cols => cols[0] === name);
  return row?.[5]?.split('/')[0];
}

/** 課題の container の名（動いている物）。 */
export function reviewContainers(ctx: Context, key: string): string[] {
  const head = `${REVIEW_PREFIX}${key.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-`;
  return ctx.exec('container', ['ls']).stdout.split('\n').map(l => l.trim().split(/\s+/)[0] ?? '').filter(n => n.startsWith(head));
}

/** 課題の container を止める（名を名指すか、その課題の物をみな）。止めた名。 */
export function reviewStop(ctx: Context, key: string, name: string | undefined): string[] {
  const mine = reviewContainers(ctx, key);
  const targets = name === undefined ? mine : [name];
  if (name !== undefined && !mine.includes(name)) throw new TpmError(`この課題の container ではありません（動いている物: ${mine.join('・') || '無し'}）: ${name}`);
  for (const target of targets) container(ctx, ['stop', target], `${target} を止めるの`);
  return targets;
}
