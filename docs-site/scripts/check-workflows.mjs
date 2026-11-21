// .github/workflows/ の workflow が、github-pages の environment を通らずに Pages に出せないかを見る（pnpm run check）。
//
// Pages の deploy を main だけに絞っているのは、github-pages の environment の branch の決まりだけ。
// この決まりは environment を書いた job にしか効かず、書かない job が pages・id-token の権限で
// actions/deploy-pages を流すと、PR の branch からでも本物の site に出る（2026-11-22 t-2tmj、台帳 #53）。
// repo の設定には、Pages の deploy に environment を求める欄が無い。だから workflow の形で止める:
//
// 1. workflow の頭の permissions に、pages: write・id-token: write・write-all を書かない（全部の job に効くため）
// 2. pages: write か id-token: write（か write-all）を持つ job は、environment に github-pages を書く
// 3. actions/deploy-pages を使う job は、environment に github-pages を書く
//
// PR の検査（site.yml）で落ちても、その PR の branch の workflow はもう走っている。push の前に手元で
// pnpm run check を流すのが、いちばん早い守り。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(REPO, ".github", "workflows");
const ENV = "github-pages";
const DEPLOY = /^actions\/deploy-pages@/;

/** permissions の値が、Pages に出せる権限を含むか */
function grantsPages(permissions) {
  if (permissions === "write-all") return true;
  if (!permissions || typeof permissions !== "object") return false;
  return ["pages", "id-token"].some((key) => permissions[key] === "write");
}

/** job の environment の名（文字列か { name } の形） */
function envName(job) {
  const env = job.environment;
  return typeof env === "string" ? env : env?.name;
}

/** 1 つの workflow の字を見て、違反の文を返す */
export function checkWorkflow(file, text) {
  const errors = [];
  const doc = parse(text) ?? {};
  if (grantsPages(doc.permissions)) {
    errors.push(
      `${file}: workflow の頭の permissions に pages・id-token の write（か write-all）がある。github-pages の environment を書いた job の permissions に移す`,
    );
  }
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    if (envName(job) === ENV) continue;
    if (grantsPages(job.permissions)) {
      errors.push(
        `${file}: job ${id} は pages・id-token の write を持つのに environment が ${ENV} でない（PR の branch からでも Pages に出せる）`,
      );
    }
    if ((job.steps ?? []).some((step) => DEPLOY.test(step?.uses ?? ""))) {
      errors.push(
        `${file}: job ${id} は actions/deploy-pages を使うのに environment が ${ENV} でない（PR の branch からでも Pages に出せる）`,
      );
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name));
  const errors = files.flatMap((name) =>
    checkWorkflow(
      `.github/workflows/${name}`,
      readFileSync(join(DIR, name), "utf8"),
    ),
  );
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.log(`✓ check-workflows: ${files.length} workflow`);
}
