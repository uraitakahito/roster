// 本文中の絶対ローカルリンク（/page/）に base を付ける Sätteri の HAST プラグイン。
//
// Starlight のサイドバーやナビは slug 経由で base を付けるが、MD/MDX 本文に書かれた
// [text](/page/) は素通しになるため、ここで補正する。既に base 付きのリンクは二重に付けない。
//
// フロントマター（hero.actions.link 等）はこの pipeline を通らない。そちらは /roster/page/ と直接書く。
import { defineHastPlugin } from "satteri";

// astro.config.ts の base と同じ
const BASE = "/roster";

export default defineHastPlugin({
  name: "rebase-links",
  element: {
    // 走査する要素を宣言する
    filter: ["a"],
    visit(node, ctx) {
      const href = node.properties?.href;
      if (typeof href !== "string") return;
      if (
        !href.startsWith("/") ||
        href.startsWith("//") ||
        href.startsWith(`${BASE}/`) ||
        href === BASE
      ) {
        return;
      }
      // 直接代入（node.properties.href = …）は arena に届かない。setProperty のみ
      ctx.setProperty(node, "href", BASE + href);
    },
  },
});
