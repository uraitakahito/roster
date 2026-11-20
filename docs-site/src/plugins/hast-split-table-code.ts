// 表のセルの中の code を、空白ごとに別の code に分ける Sätteri の HAST プラグイン。
//
// src/styles/tables.css は、表の中の code を inline-block・nowrap にして、code の中では
// 折り返さず code と code の間で折り返す。そのままだと、空白を含む長い code
// （`tpm assign "<repo>#<PR>" --role sustaining-engineer` など）の長さがそのまま列の最小の幅になり、
// 表が本文の幅からあふれて、日本語の列が数字ずつに細る（行がとても高くなる）。
// 原稿で code を空白ごとに分ける決まりは、文を直すうちに破れるので、ここで分ける。
//
// 分けた code の間には空白の text を置くので、選んで写すと元の命令に戻る。
import { defineHastPlugin } from "satteri";

const CELLS = new Set(["td", "th"]);

export default defineHastPlugin({
  name: "split-table-code",
  element: {
    filter: ["code"],
    visit(node, ctx) {
      // 中が text 1 つの code だけを見る（入れ子の要素を持つ code は触らない）
      if (node.children.length !== 1 || node.children[0].type !== "text") {
        return;
      }
      const words = node.children[0].value.split(/\s+/).filter(Boolean);
      if (words.length < 2) return;

      let p = ctx.parent(node);
      while (p && p.type === "element" && !CELLS.has(p.tagName)) {
        p = ctx.parent(p);
      }
      if (!p || p.type !== "element") return;

      ctx.replaceNode(
        node,
        words.flatMap((w, i) => [
          ...(i ? [{ type: "text" as const, value: " " }] : []),
          {
            type: "element" as const,
            tagName: "code",
            properties: { ...node.properties },
            children: [{ type: "text" as const, value: w }],
          },
        ]),
      );
    },
  },
});
