const PUNCT: Record<string, string> = {
  '\u201C': '"',
  '\u201D': '"',
  '\u2018': "'",
  '\u2019': "'",
  '\u2014': '-',
  '\u2013': '-',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u2022': '-',
  '\u00AD': '',
}

export function toWinAnsi(text: string): string {
  return [...text]
    .map((ch) => {
      if (PUNCT[ch] !== undefined) return PUNCT[ch]
      const code = ch.charCodeAt(0)
      if (code < 32) return ' '
      if (code <= 255) return ch
      return PUNCT[ch] ?? ch.normalize('NFD').replace(/\p{M}/gu, '')
    })
    .join('')
}
