import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { satteri } from "@astrojs/markdown-satteri";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

export default defineConfig({
  // user page の origin ＋ repo 名の base。README のドキュメントの URL はこの 2 つから組んだもの
  // （scripts/check-refs.mjs が突き合わせる）。base は src/plugins/hast-rebase-links.ts にもある
  site: "https://uraitakahito.github.io",
  base: "/skills",
  // 画面の絵は lossless WebP で置く。既定の service は描き直す（非可逆で、元より大きくなりうる）ので、そのまま配る
  image: { service: passthroughImageService() },
  integrations: [
    // ```mermaid をクライアント側で描く。starlight より前に置く。構文を間違えても build は
    // 通るので、図を変えたらブラウザで見る
    mermaid({ theme: "neutral" }),
    starlight({
      title: "skills",
      // 表の中の code を、code の中では折り返さず、code の間で折り返す
      customCss: ["./src/styles/tables.css"],
      // 日本語だけ。root の locale を ja にすると、Starlight の画面の字（検索・目次など）も日本語になる
      defaultLocale: "root",
      locales: {
        root: { label: "日本語", lang: "ja" },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/uraitakahito/skills",
        },
      ],
      sidebar: [
        { label: "概要", slug: "index" },
        { label: "はじめる", slug: "getting-started" },
        { label: "skill", slug: "skill" },
        { label: "担当のあいだの決まり", slug: "protocol" },
        { label: "設定", slug: "configuration" },
        { label: "運用", slug: "operations" },
        { label: "開発", slug: "development" },
      ],
    }),
  ],
  markdown: {
    // 本文の [x](/page/) に base を付ける。Starlight が書き換えるのはナビだけ
    processor: satteri({ hastPlugins: [hastRebaseLinks] }),
  },
});
