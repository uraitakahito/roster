// 依頼書の「課題の概要」の節を確かめる（tpm assign が新しい担当を起こす前）。
// 節は `<section id="summary">`（tpm/brief-template.md）。字の一致で見て、HTML の parser は使わない。中身の良し悪しは見ない。
import { readFileSync } from 'node:fs';
import type { Context } from './context.ts';
import { isPageUrl, pagePath } from './commands/page.ts';
import { TpmError } from './skill-sets.ts';

/** 概要の節に要る字の数（見出しを除く）。見出しだけの空の節を止めるため。 */
export const SUMMARY_MIN = 40;

const SECTION = /<section\b[^>]*\bid\s*=\s*(["'])summary\1[^>]*>([\s\S]*?)<\/section>/i;

/** 依頼書の HTML の概要の節の字（見出し・tag を除き、空白を詰めた物）。節が無ければ undefined。 */
export function summaryText(html: string): string | undefined {
  const inner = SECTION.exec(html)?.[2];
  if (inner === undefined) return undefined;
  return inner
    .replace(/<(h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 依頼書（置き場のページ）に概要の節があり、SUMMARY_MIN 字以上あるかを確かめる。無ければ、直し方を添えて止まる。 */
export function assertSummary(ctx: Context, key: string, url: string): void {
  if (!isPageUrl(ctx.env, url)) {
    throw new TpmError(`依頼書は置き場のページにしてください（tpm page put <file> --kind brief --key ${key} で置き、出た URL を --brief に書く）: ${url}`);
  }
  const [path = ''] = pagePath(ctx, url);
  const text = summaryText(readFileSync(path, 'utf8'));
  if (text === undefined) {
    throw new TpmError([
      `依頼書（${url}）に課題の概要の節がありません。`,
      `振る前に課題を読み（Jira・GitHub の Issue の Key なら tpm issue view <Key>）、依頼書に <section id="summary"> を書いてください（ひな形は tpm/brief-template.md の「課題の概要の節」）。`,
      '課題が無い仕事（t- の Key）では、Product Manager の言葉から概要を書きます。',
    ].join('\n'));
  }
  const length = [...text].length;
  if (length < SUMMARY_MIN) {
    throw new TpmError(`依頼書の課題の概要の節が短すぎます（${length} 字。見出しを除いて ${SUMMARY_MIN} 字以上）。何が求められているかを TPM 担当の言葉で書いてください: ${url}`);
  }
}
