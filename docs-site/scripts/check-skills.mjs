// skill-sets/ の SKILL.md の frontmatter が、Claude Code に渡す設定として決まりどおりかを見る（pnpm run check）。
//
// 担当の居場所には、どの skill セットも --add-dir で全部渡る（cli/src/run-role.ts）。だから model が
// 自分で呼べる skill は、どの担当の居場所の一覧にも載り、呼ばれると困る居場所でも呼ばれうる。
// 一覧に載るのは description と when_to_use を続けた字で、disable-model-invocation: true の skill は
// どちらも載らない（Claude Code の skill の文書）。そこで次を止める（2026-11-22 t-cyyr）:
//
// 1. frontmatter が無い・YAML の mapping として読めない（引用符の無い値に「: 」を書くと読めない）
// 2. 欄の名が Claude Code の文書の一覧に無い（知らない欄は黙って無視される。when-to-use など）
// 3. name が SKILL.md の folder の名と違う・description が空
// 4. disable-model-invocation: true でない skill が、when_to_use を持たないか、その中に「呼ばない」場面を書かない
// 5. disable-model-invocation: true の skill が when_to_use を持つ（一覧に載らず、効かない）
// 6. description と when_to_use を合わせて 1,536 字を超える（一覧で切られる）
//
// argument-hint は、/ を打つと命令の名の後ろに出る、渡せる物の手がかり。次も止める（2026-11-22 t-5kex）:
//
// 7. 本文が引数の置き場（$ARGUMENTS・$0〜$9・arguments の欄の $名）を使うのに argument-hint が無い
//    （/ を打つ人に、渡せる物が見えない）
// 8. 本文が引数の置き場を使わないのに argument-hint がある（渡しても効かない物を示す）
// 9. argument-hint が空でない字でない（引用符で囲まない [x] は YAML の配列になり、[ ] が消える）
//
// allowed-tools は、skill を呼んだ turn だけ道具の許可を渡す欄。次も止める（2026-11-22 t-qnfh）:
//
// 10. allowed-tools の欄がある（担当は bypassPermissions で起きるので効かず、bypass をやめても
//     呼んだ turn だけしか効かない。許可を渡すなら担当を起こす旗か settings の allow で）
//
// model・effort は、skill を呼んだ turn の残りだけ model と effort を替える欄（fork なら fork の中だけ）。
// 次も止める（2026-11-22 t-4zk5）:
//
// 11. context: fork でない skill が model か effort の欄を持つ（呼んだ turn だけ効き、次の入力で
//     戻る。担当の model・effort は config.jsonc か roster assign の旗で決める）
//
// context: fork は、skill を会話の外の subagent に任せ、結果だけを受け取る欄。subagent には SKILL.md の本文と
// 引数だけが渡り、担当の環境変数と guard の hook は受け継ぐ。次も止める（2026-11-22 t-hf43）:
//
// 12. agent か background の欄が context: fork でない skill にある・context の値が fork でない（黙って無視される）
// 13. context: fork の skill が disable-model-invocation: true（担当の skill を fork にすると、手順が subagent の
//     中に消え、【brief】や【answer】が届く 2 turn 目からの会話は手順を知らない）
// 14. context: fork の skill が background: false を書かない（既定は裏で動き、呼んだ担当が結果を待たずに進む）
// 15. context: fork の skill の本文が、読む物のほかの roster の命令を書く（subagent の roster は呼んだ担当として
//     動くので、知らせ・状態・名簿が呼んだ担当の名で変わる。知らせるのは呼んだ担当）
//
// skill セットの .claude/agents/*.md は、手伝い（subagent）の定義。--add-dir の先の定義も Claude Code が読み、
// 同じ名なら組み込みの手伝いより勝つ（文書には無い。Claude Code 2.1.332 の中と、手元の試しで確かめた。
// 2026-11-28 t-cjj4。core の Explore.md で、どの席の Explore も Haiku で動かす）。次も止める:
//
// 16. 手伝いの定義の frontmatter が無い・YAML の mapping として読めない・欄の名が AGENT_FIELDS に無い
// 17. name が file の名と違う・description が空・model が無い（書かないと親の model を受け継ぎ、定義を置いた訳が消える）
// 18. READ_ONLY_AGENTS の定義の disallowedTools が、READ_ONLY_DENIED をみな持たない（定義し直すと組み込みの
//     止めは引き継がれない。roster の guard は Artifact を見ないので、ここで止める）
// 19. skill の agent の値が、組み込みの手伝いの名でも、skill セットの .claude/agents/ にある名でもない
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// 15. fork の skill の本文で打ってよい roster の命令（読むだけの物と、Auditor が証拠に使う時系列のページと、
// file だけを書く図の命令（figure-fix が打つ。知らせ・状態・名簿は変えない）。
// ここに無い命令は止まるので、roster に命令が増えても、知らせる命令が fork に入り込まない
const FORK_COMMANDS = [
  "page path",
  "page list",
  "file path",
  "file list",
  "issue view",
  "incident review",
  "incident follow",
  "incident timeline",
  "roles",
  "infra list",
  "castlist find",
  "castlist show",
  "castlist lineage",
  "castlist events",
  "castlist settings",
  "figure validate",
  "figure embed",
  "figure shot",
];
// protocol.ts は型の import だけなので、Node がそのまま読める（check-refs.mjs の 10 と同じ）
const { COMMANDS } = await import(join(REPO, "cli", "src", "protocol.ts"));
for (const c of FORK_COMMANDS)
  if (!COMMANDS.includes(c))
    throw new Error(
      `FORK_COMMANDS の roster ${c} が cli/src/protocol.ts の COMMANDS に無い`,
    );
const GROUPS = new Set(
  COMMANDS.filter((c) => c.includes(" ")).map((c) => c.split(" ")[0]),
);
const MAX = 1536;
const FIELDS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  "metadata",
  "license",
  "compatibility",
]);

// 16. 手伝いの定義の欄。Claude Code 2.1.332 の中の、手伝いの定義の欄の並べ（JSON の定義の prompt を除く）に、
// .md の frontmatter を読む所が読む color を足した物。omitClaudeMd（CLAUDE.md を読まない）は文書に無く、版の中にだけある
const AGENT_FIELDS = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "effort",
  "permissionMode",
  "mcpServers",
  "hooks",
  "maxTurns",
  "autoCompactWindow",
  "skills",
  "initialPrompt",
  "memory",
  "background",
  "omitClaudeMd",
  "isolation",
  "color",
]);
// 18. 読むだけの手伝いと、止める道具。Claude Code 2.1.332 の Agent tool の説明の Explore の行
// 「All tools except …」から写した。版が上がると組み込みの並べが増えうるので、版上げの時に見直す
const READ_ONLY_AGENTS = new Set(["Explore", "audit-reader"]);
export const READ_ONLY_DENIED = [
  "Agent",
  "Artifact",
  "ArtifactComments",
  "ArtifactData",
  "ArtifactCheck",
  "ExitPlanMode",
  "Edit",
  "Write",
  "NotebookEdit",
];
// 19. 組み込みの手伝いの名（Claude Code 2.1.332）
const BUILTIN_AGENTS = new Set([
  "general-purpose",
  "Explore",
  "Plan",
  "claude",
  "statusline-setup",
  "claude-code-guide",
  "web-fetch",
]);

/** frontmatter を読む。読めなければ違反の文を返す */
function frontmatter(file, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return { error: `${file}: 頭に --- で囲んだ frontmatter が無い` };
  let fm;
  try {
    fm = parse(m[1]);
  } catch (e) {
    return {
      error: `${file}: frontmatter が YAML として読めない（値に「: 」があれば言い換える）: ${e.message.split("\n")[0]}`,
    };
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm))
    return { error: `${file}: frontmatter が YAML の mapping でない` };
  return { fm, head: m[0] };
}

/** 道具の並べ（「A, B」の字か配列）を名の配列にする */
function toolList(value) {
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  return Array.isArray(value) ? value.map(String) : [];
}

/** 1 つの手伝いの定義（.claude/agents/*.md）の字を見て、違反の文を返す（16〜18） */
export function checkAgent(file, text) {
  const { fm, error } = frontmatter(file, text);
  if (error) return [error];
  const errors = [];
  for (const key of Object.keys(fm))
    if (!AGENT_FIELDS.has(key)) errors.push(`${file}: 知らない欄: ${key}`);
  const stem = basename(file).replace(/\.md$/, "");
  if (fm.name !== stem)
    errors.push(`${file}: name（${fm.name}）が file の名（${stem}）と違う`);
  if (typeof fm.description !== "string" || fm.description.trim() === "")
    errors.push(`${file}: description が無い`);
  if (typeof fm.model !== "string" || fm.model.trim() === "")
    errors.push(
      `${file}: model が無い（書かないと親の model を受け継ぐ。親と同じでよければ inherit と書く）`,
    );
  if (READ_ONLY_AGENTS.has(fm.name)) {
    const denied = new Set(toolList(fm.disallowedTools));
    const missing = READ_ONLY_DENIED.filter((t) => !denied.has(t));
    if (missing.length > 0)
      errors.push(
        `${file}: 読むだけの手伝いの disallowedTools に ${missing.join("・")} が無い（定義し直すと組み込みの止めは引き継がれない）`,
      );
  }
  return errors;
}

/** skill の agent の値が、組み込みか定義にある名か（19） */
export function checkAgentRef(file, text, defined) {
  const { fm } = frontmatter(file, text);
  if (!fm || fm.agent === undefined) return [];
  return BUILTIN_AGENTS.has(fm.agent) || defined.has(fm.agent)
    ? []
    : [
        `${file}: agent（${fm.agent}）が組み込みの手伝いにも skill セットの .claude/agents/ にも無い`,
      ];
}

/** 本文が Claude Code の引数の置き場を使うか（前に \ がある $ は置き換わらないので数えない） */
function usesArguments(body, fm) {
  if (/(?<!\\)\$(ARGUMENTS\b|\d)/.test(body)) return true;
  const names =
    typeof fm.arguments === "string"
      ? fm.arguments.split(/\s+/)
      : Array.isArray(fm.arguments)
        ? fm.arguments.map(String)
        : [];
  return names.some((name) => {
    if (name === "") return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<!\\\\)\\$${escaped}(?![\\w-])`).test(body);
  });
}

/** 本文が書く roster の命令（check-refs.mjs の 10 と同じ数え方。「roster の命令」のような字は数えない） */
function tpmCommands(body) {
  const found = [];
  for (const m of body.matchAll(
    /(?<![\w/=-])roster[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?/g,
  ))
    found.push(GROUPS.has(m[1]) && m[2] ? `${m[1]} ${m[2]}` : m[1]);
  return found;
}

/** 1 つの SKILL.md の字を見て、違反の文を返す */
export function checkSkill(file, text) {
  const { fm, head, error } = frontmatter(file, text);
  if (error) return [error];
  const body = text.slice(head.length);

  const errors = [];
  for (const key of Object.keys(fm))
    if (!FIELDS.has(key)) errors.push(`${file}: 知らない欄: ${key}`);

  const folder = basename(dirname(file));
  if (fm.name !== folder)
    errors.push(`${file}: name（${fm.name}）が folder の名（${folder}）と違う`);
  if (typeof fm.description !== "string" || fm.description.trim() === "")
    errors.push(`${file}: description が無い`);

  const when = fm.when_to_use;
  if (fm["disable-model-invocation"] === true) {
    if (when !== undefined)
      errors.push(
        `${file}: disable-model-invocation: true の skill に when_to_use がある（一覧に載らず効かない）`,
      );
  } else if (typeof when !== "string" || when.trim() === "") {
    errors.push(
      `${file}: model が呼べる skill に when_to_use が無い（呼ぶ場面と呼ばない場面を書く。呼ばせないなら disable-model-invocation: true）`,
    );
  } else if (!when.includes("呼ばない")) {
    errors.push(`${file}: when_to_use に「呼ばない」場面が無い`);
  }

  const length =
    (typeof fm.description === "string" ? fm.description.length : 0) +
    (typeof when === "string" ? when.length : 0);
  if (length > MAX)
    errors.push(
      `${file}: description と when_to_use で ${length} 字（${MAX} 字を超えた分は一覧で切られる）`,
    );

  const hint = fm["argument-hint"];
  if (hint !== undefined && (typeof hint !== "string" || hint.trim() === ""))
    errors.push(
      `${file}: argument-hint が字でない（"[…]" のように引用符で囲む）`,
    );
  if (usesArguments(body, fm)) {
    if (hint === undefined)
      errors.push(
        `${file}: 本文が引数を使うのに argument-hint が無い（渡せる物を書く）`,
      );
  } else if (hint !== undefined) {
    errors.push(`${file}: 本文が引数を使わないのに argument-hint がある`);
  }
  if (Object.hasOwn(fm, "allowed-tools"))
    errors.push(
      `${file}: allowed-tools がある（担当は bypassPermissions で起き効かない。効いても呼んだ turn だけ。書かない）`,
    );
  const turnOnly = ["model", "effort"].filter((key) => Object.hasOwn(fm, key));
  if (turnOnly.length > 0 && fm.context !== "fork")
    errors.push(
      `${file}: ${turnOnly.join("・")} は context: fork の skill にだけ書く（呼んだ turn だけ効き、次の入力で戻る。担当の model は config.jsonc か roster assign --model で）`,
    );

  if (Object.hasOwn(fm, "context") && fm.context !== "fork")
    errors.push(
      `${file}: context に書けるのは fork だけ（ほかの値は黙って無視される）`,
    );
  if (fm.context !== "fork") {
    const forkOnly = ["agent", "background"].filter((key) =>
      Object.hasOwn(fm, key),
    );
    if (forkOnly.length > 0)
      errors.push(
        `${file}: ${forkOnly.join("・")} は context: fork の skill にだけ書く（fork でなければ黙って無視される）`,
      );
  } else {
    if (fm["disable-model-invocation"] === true)
      errors.push(
        `${file}: 担当の skill（disable-model-invocation: true）を context: fork にしない（手順が subagent の中に消え、2 turn 目からの会話は手順を知らない）`,
      );
    if (fm.background !== false)
      errors.push(
        `${file}: context: fork の skill は background: false を書く（既定は裏で動き、呼んだ担当が結果を待たずに進む）`,
      );
    const denied = [
      ...new Set(tpmCommands(body).filter((c) => !FORK_COMMANDS.includes(c))),
    ];
    if (denied.length > 0)
      errors.push(
        `${file}: context: fork の skill の本文に roster ${denied.join("・roster ")} がある（subagent の roster は呼んだ担当として動く。知らせ・状態・名簿の命令は呼んだ担当が打つ）`,
      );
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // add 前の新しい skill も見る（check-refs.mjs の committable と同じ数え方）
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO, encoding: "utf8" },
  ).split("\n");
  const skills = files.filter(
    (f) => f.startsWith("skill-sets/") && f.endsWith("/SKILL.md"),
  );
  const agents = files.filter((f) =>
    /^skill-sets\/[^/]+\/\.claude\/agents\/[^/]+\.md$/.test(f),
  );
  const defined = new Set(agents.map((f) => basename(f).replace(/\.md$/, "")));
  const errors = [
    ...skills.flatMap((f) => {
      const text = readFileSync(join(REPO, f), "utf8");
      return [...checkSkill(f, text), ...checkAgentRef(f, text, defined)];
    }),
    ...agents.flatMap((f) =>
      checkAgent(f, readFileSync(join(REPO, f), "utf8")),
    ),
  ];
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.log(
    `✓ check-skills: ${skills.length} skill・${agents.length} 手伝いの定義`,
  );
}
