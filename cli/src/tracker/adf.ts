// Jira のコメントの形（Atlassian Document Format）。段落だけで書く（箇条書きや taskList は、読み返すときに消える道具がある）。
import { noteHead, type Note } from './types.ts';

interface AdfText {
  type: 'text'
  text: string
  marks?: { type: 'link', attrs: { href: string } }[]
}

interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
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

/** ADF を、段落を改行でつないだ字にする。 */
export function adfToText(doc: unknown): string {
  const flat = (node: AdfNode): string => node.text ?? (node.content ?? []).map(flat).join('');
  return ((doc as AdfNode | null)?.content ?? []).map(flat).join('\n');
}
