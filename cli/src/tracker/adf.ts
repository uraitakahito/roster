// Jira のコメントの形（Atlassian Document Format）。段落だけで書く（箇条書きや taskList は、読み返すときに消える道具がある）。
import { noteHead, type Note } from './types.ts';

/** ADF の字の node。リンクは link の mark で付ける。 */
export interface AdfText {
  type: 'text'
  text: string
  marks?: { type: 'link', attrs: { href: string } }[]
}

interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
  marks?: { type: string, attrs?: { href?: unknown } }[]
}

const text = (value: string): AdfText => ({ type: 'text', text: value });
/** リンクは、URL をそのまま字にして link の mark を付ける（字も href も URL）。 */
const link = (url: string): AdfText => ({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
const paragraph = (...content: AdfText[]) => ({ type: 'paragraph', content });

/** 記録を ADF にする。 */
export function noteToAdf(note: Note) {
  return {
    type: 'doc',
    version: 1,
    content: [
      paragraph(text(noteHead(note))),
      ...note.links.map(l => paragraph(text(`${l.label}: `), link(l.url))),
      ...note.points.map(p => paragraph(text(p))),
    ],
  };
}

/** 中に字（inline）を持つ block。 */
const INLINE_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

/** inline の node を字にする。リンクは、字が URL でなければ URL を（）で添える。 */
function inline(node: AdfNode): string {
  if (node.type === 'text') {
    const value = node.text ?? '';
    const href = node.marks?.find(m => m.type === 'link')?.attrs?.href;
    return typeof href === 'string' && href !== value ? `${value}（${href}）` : value;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'inlineCard' && typeof node.attrs?.url === 'string') return node.attrs.url;
  // mention・emoji・status などは attrs.text に字を持つ。
  if (typeof node.attrs?.text === 'string') return node.attrs.text;
  return (node.content ?? []).map(inline).join('');
}

/** block の node を行にする。リストは「- 」「1. 」を頭に付け、入れ子は字下げする。 */
function blockLines(node: AdfNode): string[] {
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const start = typeof node.attrs?.order === 'number' ? node.attrs.order : 1;
    return (node.content ?? []).flatMap((item, i) => {
      const head = node.type === 'bulletList' ? '- ' : `${start + i}. `;
      return (item.content ?? []).flatMap(blockLines).map((line, j) => (j === 0 ? head : ' '.repeat(head.length)) + line);
    });
  }
  if (INLINE_BLOCKS.has(node.type)) {
    const level = node.type === 'heading' && typeof node.attrs?.level === 'number' ? node.attrs.level : 0;
    return `${'#'.repeat(level)}${level > 0 ? ' ' : ''}${(node.content ?? []).map(inline).join('')}`.split('\n');
  }
  if (node.content === undefined) return node.text === undefined ? [] : [node.text];
  return node.content.flatMap(blockLines);
}

/** ADF を字にする。段落は改行でつなぎ、リストは「- 」「1. 」の行にし、リンクの URL は残す。 */
export function adfToText(doc: unknown): string {
  return ((doc as AdfNode | null)?.content ?? []).flatMap(blockLines).join('\n');
}
