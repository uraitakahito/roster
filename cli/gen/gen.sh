#!/usr/bin/env bash
# 2 つの server（castlist・pagetray）の定義から、roster が呼ぶ TypeScript の client（cli/gen/<repo>-client/）を作り直す（AI-36）。
# 生成した TS（src/）と、tsc で build した JS（dist-cjs/）と型（dist-types/）を repo に入れ、手で直さない。
# roster は build 無しで動くので、ESM の roster からは dist-cjs/ を createRequire で読む（生成した TS は拡張子の無い import なので、
# Node が型を消して直に動かす形は通らない）。
#   cli/gen/gen.sh           定義を下の DEFS の tag から取り直し、client を作り直して置き換える
#   cli/gen/gen.sh --check   取った定義（cli/gen/model/）が下の digest と合うか、作り直した client と入れてある物が同じかを見る（CI が流す）。
#                            違えば exit 1。定義は取りに行かない（入れてある物を digest で見る）
# 要る物: curl・unzip・jq・shasum か sha256sum・node と cli/node_modules（pnpm install。tsc と、client が引く @smithy/* など）。
# Smithy の CLI は JRE を同梱しているので、Java は要らない。
# 生成器の版は cli/gen/smithy-build.json に書く。そこに名指した Maven の物は、公開から 2 日たっていなければ使わない
# （pnpm の minimumReleaseAge に合わせた物。名指した物だけを見て、それが引く物は見ない）。
# 作り方は pagetray の ci/gen.sh に倣う（Smithy の CLI の版と digest も同じ。cache の folder は roster 用に分ける）。
# 作るのは cli/gen/build（git は無視）。macOS の bash（3.2）でも動く書き方にする。
set -euo pipefail

SMITHY_VERSION=1.74.1
# release の digest（https://github.com/smithy-lang/smithy/releases/tag/1.74.1）。
# 版は smithy-build.json の trait の package（smithy-aws-traits など）と同じにする。上げる時は 2 か所と digest を一緒に替える。
sha_for() {
  case "$1" in
    darwin-aarch64) echo ebb5e931936aa503055b4620c4981319f2b060656482553ada0151235ff0f1ac ;;
    darwin-x86_64) echo 06b5fa6660fd3ab0281511af1d04f3128e10fa6220c552bc2b94ff18d660886d ;;
    linux-aarch64) echo c563b5387c66fe04b8c459178dfcc08316798bc107c03fd92474dd8a0c028850 ;;
    linux-x86_64) echo 6b50c0b9f2443400bb7115b9badb54b3609816ec5fb4f625954eadd2f6b2f52a ;;
    *) return 1 ;;
  esac
}
# 取る定義を固める所。ここだけに書く。1 行に 1 つの file:
#   <repo> <release の tag> <repo の中の path> <SHA-256> [<この file の service から作る client の shape id>]
# 取った file は cli/gen/model/<repo>/ に置く。5 つ目の欄がある行ごとに、client を cli/gen/<repo>-client/ に作る。
# 上げる・足す時は行を替えて gen.sh を流し、取った定義と作り直した client を同じ commit に入れる。
# pagetray の定義（ai.pagetray）は ai.common を使うが、それは castlist の common.smithy を使う（pagetray の tag の model/castlist/ の写しと同じ digest）。
DEFS="
castlist v2.0.0 model/model/common.smithy 6425614b79d58d7149f17396cebc3eb30e0e6c511516957d82004eb329fb66d0
castlist v2.0.0 model/model/castlist.smithy a913649956b5ee00a793f845454b817fa9d6dbebee8704e1a477e5f25cc6473a ai.castlist#Castlist
pagetray v1.2.0 model/model/pagetray.smithy 9778291651cf4d3a8fb2ecff8446bb1cf17d6769b7071b9e61c2bd0a2fc26eea ai.pagetray#Pagetray
"
MIN_AGE_SECONDS=$((2 * 24 * 60 * 60))
# つなぎの一時の失敗（github.com や Maven Central への時間切れ）は、少し待って送り直す（pagetray の ci/gen.sh と同じ）。
# 送り直すのは時間切れ・5xx・つなぐ前の断り。404 などの書き違いは早く落とす（--retry-all-errors は使わない）。
CURL_RETRY="--retry 5 --retry-connrefused --retry-delay 5 --connect-timeout 20"

gen=$(cd "$(dirname "$0")" && pwd)
cli=$(dirname "$gen")
check=false
case "${1:-}" in
  --check) check=true ;;
  "") ;;
  *) echo "使い方: cli/gen/gen.sh [--check]" >&2; exit 2 ;;
esac

ng() {
  echo "NG: $*" >&2
  exit 1
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
[ -x "$cli/node_modules/.bin/tsc" ] || ng "cli/node_modules が無い（cli/ で pnpm install --frozen-lockfile を打つ）"

# 1. 取った定義（cli/gen/model/）。--check は入れてある物を digest で見るだけ。ほかは tag から取り直してから見る。
copies="$gen/model"
defs() { echo "$DEFS" | sed '/^$/d'; }
if ! $check; then
  defs | while read -r repo tag path want service; do
    f=$(basename "$path")
    mkdir -p "$work/model/$repo"
    curl -fsSL $CURL_RETRY -o "$work/model/$repo/$f" "https://raw.githubusercontent.com/uraitakahito/$repo/$tag/$path"
    got=$(sha256 "$work/model/$repo/$f")
    [ "$got" = "$want" ] || ng "$repo の $tag の $path が、固めた digest と違う（${got}。$want のはず）。cli/gen/model/ は替えない"
  done
  rm -rf "$copies"
  cp -R "$work/model" "$copies"
fi
defs | while read -r repo tag path want service; do
  f="$repo/$(basename "$path")"
  [ -f "$copies/$f" ] || ng "取った定義が無い: cli/gen/model/${f}（cli/gen/gen.sh を流す）"
  got=$(sha256 "$copies/$f")
  [ "$got" = "$want" ] || ng "cli/gen/model/$f が $repo の $tag の物と違う（${got}。$want のはず）"
done
want_files=$(defs | while read -r repo tag path rest; do echo "$repo/$(basename "$path")"; done | sort)
have_files=$(cd "$copies" && find . -type f | sed 's|^\./||' | sort)
[ "$want_files" = "$have_files" ] || ng "cli/gen/model/ の file が DEFS と合わない（DEFS: $(echo $want_files)。在る物: $(echo $have_files)）"

# 作る client: <repo>=<service>。
clients=$(defs | while read -r repo tag path want service; do [ -z "$service" ] || echo "$repo=$service"; done)
[ -n "$clients" ] || ng "DEFS に client を作る行（5 つ目の欄）が無い"

# 2. Smithy の CLI を取る（版と digest を確かめ、cache に置く）。
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
[ "$arch" = arm64 ] && arch=aarch64
platform="$os-$arch"
want=$(sha_for "$platform") || ng "Smithy の CLI の無い機械: $platform"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/roster-smithy/$SMITHY_VERSION-$platform"
smithy="$cache/smithy-cli-$platform/bin/smithy"
# cache（手元の folder と、CI の actions/cache）には、取った zip を残す。毎回 zip の digest を見てから、zip から開き直す
# （開いた物を cache から戻してそのまま使うと、digest を見ないまま走らせることになるため）。
zip="$cache/cli.zip"
if [ ! -f "$zip" ] || [ "$(sha256 "$zip")" != "$want" ]; then
  rm -rf "$cache"
  mkdir -p "$cache"
  curl -fsSL $CURL_RETRY -o "$zip" "https://github.com/smithy-lang/smithy/releases/download/$SMITHY_VERSION/smithy-cli-$platform.zip"
  got=$(sha256 "$zip")
  [ "$got" = "$want" ] || ng "Smithy の CLI の digest が違う（${got}。$want のはず）"
fi
rm -rf "$cache/smithy-cli-$platform"
unzip -q -o "$zip" -d "$cache"
[ -x "$smithy" ] || ng "Smithy の CLI の zip に bin/smithy が無い"

# 3. 生成器（Maven の物）が、公開から 2 日たっているか。
# 依存は JSON として読む（.maven.dependencies）。どれも group:artifact:版 の形でなければ断る。
# 公開の時刻は増えないので、一度 2 日を越えたと見た物は、cache に印を置き、次からは Maven Central に聞かない
# （CI の見張りの試しで何度も流すと、Maven Central が 429 で断ることがあった。#211）。
now=$(date -u +%s)
deps=$(jq -r '.maven.dependencies // [] | .[]' "$gen/smithy-build.json") || ng "cli/gen/smithy-build.json を JSON として読めない"
[ -n "$deps" ] || ng "cli/gen/smithy-build.json に Maven の依存が無い"
aged="$cache/maven-aged"
mkdir -p "$aged"
for dep in $deps; do
  echo "$dep" | grep -Eqx '[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+:[0-9][a-zA-Z0-9._-]*' || ng "Maven の依存の形が違う: $dep"
  [ -f "$aged/$dep" ] && continue
  group=${dep%%:*}
  rest=${dep#*:}
  artifact=${rest%%:*}
  version=${rest#*:}
  pom="https://repo1.maven.org/maven2/$(echo "$group" | tr . /)/$artifact/$version/$artifact-$version.pom"
  modified=$(curl -fsSI $CURL_RETRY "$pom" | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p')
  [ -n "$modified" ] || ng "$dep の公開の時刻を読めない（${pom}）"
  if date -u -d "$modified" +%s >/dev/null 2>&1; then
    published=$(date -u -d "$modified" +%s)
  else
    published=$(LC_ALL=C date -u -j -f '%a, %d %b %Y %H:%M:%S GMT' "$modified" +%s)
  fi
  [ $((now - published)) -ge $MIN_AGE_SECONDS ] || ng "$dep は公開から 2 日たっていない（${modified}）"
  : >"$aged/$dep"
done

# 4. 作る（cli/gen/build で。git は無視する）。client ごとに 1 つの projection にする（typescript-client-codegen は
# projection に 1 つしか置けない）。projection は smithy-build.json に書かず、DEFS から足す（足すのを DEFS の 1 行で済ませる）。
build="$gen/build"
rm -rf "$build"
mkdir -p "$build"
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const [config, out, gen, ...clients] = process.argv.slice(1);
const c = JSON.parse(readFileSync(config, "utf8"));
c.sources = c.sources.map(s => resolve(gen, s));
c.projections = Object.fromEntries(clients.map(x => {
  const [repo, service] = x.split("=");
  return [repo, { plugins: { "typescript-client-codegen": { service, package: `${repo}-client`, packageVersion: "0.0.0", private: true } } }];
}));
writeFileSync(out, JSON.stringify(c, null, 2) + "\n");
' "$gen/smithy-build.json" "$build/smithy-build.json" "$gen" $clients
(cd "$build" && "$smithy" build --quiet --config smithy-build.json --output "$build/smithy" >"$work/smithy.log" 2>&1) || {
  cat "$work/smithy.log" >&2
  ng "smithy build が落ちた"
}

# 5. client ごとに、生成した TS を tsc で build し、入れる物（src・package.json・dist-cjs・dist-types）だけを揃える。
# 生成器が作るほかの物（yarn の script の設定・api-extractor・vitest・test/ の protocol の試験・dist-* を無視する .gitignore）は入れない。
# build は cli/ の中で打つので、tsc（cli/node_modules の版）も client が引く @smithy/* も、roster の lockfile の版になる。
# 生成した package.json には "type" が無い（commonjs）ので、tsc は CJS を書き出し、拡張子の無い import も通る。
bad=0
for pair in $clients; do
  repo=${pair%%=*}
  name="$repo-client"
  made="$build/smithy/$repo/typescript-client-codegen"
  [ -f "$made/package.json" ] && [ -d "$made/src" ] || ng "$name が作られていない（$made）"
  out="$build/$name"
  mkdir -p "$out"
  cp -R "$made/src" "$out/src"
  cp "$made/package.json" "$out/package.json"
  cat >"$out/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist-cjs",
    "declaration": true,
    "declarationDir": "dist-types",
    "newLine": "lf"
  },
  "include": ["src"]
}
EOF
  (cd "$out" && "$cli/node_modules/.bin/tsc" -p tsconfig.json) || ng "$name の tsc が落ちた"
  rm "$out/tsconfig.json"
  # client が引く package（生成した package.json の dependencies）は、roster の cli/package.json の dependencies に在るはず
  # （dist-cjs/ は cli/node_modules から引く）。
  missing=$(node -e '
const { readFileSync } = require("node:fs");
const [client, roster] = process.argv.slice(1).map(f => JSON.parse(readFileSync(f, "utf8")));
console.log(Object.keys(client.dependencies ?? {}).filter(d => !(d in (roster.dependencies ?? {}))).join(" "));
' "$out/package.json" "$cli/package.json")
  [ -z "$missing" ] || ng "$name が引く package が cli/package.json の dependencies に無い: $missing"
  dir="$gen/$name"
  if $check; then
    if ! diff -r "$out" "$dir" >"$work/diff.txt"; then
      head -50 "$work/diff.txt" >&2
      echo "NG: cli/gen/$name/ が定義と合わない。cli/gen/gen.sh を流して、作り直した物を commit する" >&2
      bad=1
    else
      echo "cli/gen/$name/ は定義（cli/gen/model/）と合っている"
    fi
  else
    rm -rf "$dir"
    cp -R "$out" "$dir"
    echo "作り直した: cli/gen/$name/"
  fi
done
# DEFS に無い client の folder が残っていないか（行を消した時）。
for dir in "$gen"/*-client; do
  [ -d "$dir" ] || continue
  repo=$(basename "$dir" -client)
  echo "$clients" | grep -q "^$repo=" || { echo "NG: cli/gen/$(basename "$dir")/ は DEFS に無い（消す）" >&2; bad=1; }
done
[ "$bad" = 0 ] || exit 1
