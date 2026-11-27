// 返事の言葉を数える（副作用なし）。TPM 担当の席の Stop の hook（roster reply-language check）が使う。
// 監査 audit-2 の R13・t-jen6 の plan-2。閾値と除く物の訳は plan-2 の「数え方と閾値の訳」。

/** 仮名と漢字が、数えた字のこの割合より少なければ、英語の返事とみなす。 */
export const JAPANESE_SHARE = 0.2;

/** 除いた後の字がこれより少なければ、数えない（「OK」・番号だけの返事などで割合が揺れるため）。 */
export const MIN_LETTERS = 20;

/** 仮名（ひらがな・カタカナ。半角カタカナも）と漢字（々 も）。長音 ー と 〆 は Script が Common なので、字で足す（review-6 の指摘 6）。 */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー〆]/u;

/** 字（文字の類。数字・記号・空白は数えない）。 */
const LETTER = /\p{L}/u;

/**
 * 決まりの上で英語のまま書いてよい物を除く: コードの枠・`…`・原文の写し（\> で始まる行）・URL と file の path（/ を含む英数字と記号の塊）。
 * 英数字と記号だけを除く（日本語は空白で区切らないので、空白までを除くと、URL や path に続く日本語まで消える。review-2 の指摘 3・review-6 の指摘 2）。
 * `…` で囲まない file の名と命令の名（guard.ts など）は除かず、英語の字として数える（11-23〜11-27 の記録では、それで日本語の返事を止めた例は無い）。
 */
export function stripAllowed(text: string): string {
  return text
    .replaceAll(/```[\s\S]*?```/gu, '')
    .replaceAll(/`[^`\n]*`/gu, '')
    .replaceAll(/^\s*>.*$/gmu, '')
    .replaceAll(/[!-~]*\/[!-~]*/gu, '');
}

/** 数えた結果。share は、数えた字のうち仮名と漢字の割合。letters は、数えた字の数。 */
export interface Counted {
  share: number
  letters: number
}

/** 返事の字を数える。除いた後の字が MIN_LETTERS に満たなければ、割合は出さない（share は undefined）。 */
export function countJapanese(text: string): Counted | { share: undefined, letters: number } {
  const letters = [...stripAllowed(text)].filter(c => LETTER.test(c));
  if (letters.length < MIN_LETTERS) return { share: undefined, letters: letters.length };
  return { share: letters.filter(c => JAPANESE.test(c)).length / letters.length, letters: letters.length };
}

/** 英語の返事か（数えない短い返事は false）。 */
export function isEnglish(counted: { share: number | undefined }): boolean {
  return counted.share !== undefined && counted.share < JAPANESE_SHARE;
}
