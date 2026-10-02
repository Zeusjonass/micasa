import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { contractHeading } from '../contracts/heading'
import { pluralPartyLabel, resolveFooter, splitEmphasis, type EmphasisRun } from '../contracts/emphasis'
import type { Clause, ContractType, DocumentFooter } from '../types'
import { toWinAnsi } from './winAnsi'

const PAGE = { width: 612, height: 792 }
const MARGIN = 58
const FOOTER = 48

type BuiltPdf = {
  bytes: Uint8Array
  base64: string
}

function safeText(text: string, font: PDFFont, size: number): string {
  return [...toWinAnsi(text)]
    .filter((ch) => {
      try {
        font.widthOfTextAtSize(ch, size)
        return true
      } catch {
        return false
      }
    })
    .join('')
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return wrapRuns([{ text }], font, font, size, maxWidth).map((line) =>
    line.map((part) => part.text).join(''),
  )
}

function wrapRuns(
  runs: EmphasisRun[],
  regular: PDFFont,
  bold: PDFFont,
  size: number,
  maxWidth: number,
): Array<Array<{ text: string; emphasize?: boolean }>> {
  const lines: Array<Array<{ text: string; emphasize?: boolean }>> = []
  let current: Array<{ text: string; emphasize?: boolean }> = []
  let width = 0

  const fontOf = (emphasize?: boolean) => (emphasize ? bold : regular)

  const pushLine = () => {
    lines.push(current)
    current = []
    width = 0
  }

  for (const run of runs) {
    const pieces = safeText(run.text, fontOf(run.emphasize), size).split(/(\s+)/)
    for (const piece of pieces) {
      if (!piece) continue
      if (piece.includes('\n')) {
        if (current.length) pushLine()
        continue
      }
      const pieceWidth = fontOf(run.emphasize).widthOfTextAtSize(piece, size)
      if (width + pieceWidth > maxWidth && current.length && !/^\s+$/.test(piece)) {
        pushLine()
      }
      if (!current.length && /^\s+$/.test(piece)) continue
      current.push({ text: piece, emphasize: run.emphasize })
      width += pieceWidth
    }
  }
  if (current.length) lines.push(current)
  return lines
}

function drawHeader(
  page: PDFPage,
  fonts: { serif: PDFFont; sans: PDFFont },
  type: ContractType,
) {
  const { width, height } = page.getSize()
  page.drawRectangle({
    x: 0,
    y: height - 36,
    width,
    height: 36,
    color: rgb(0.078, 0.141, 0.122),
  })
  page.drawText('MiCasa', {
    x: MARGIN,
    y: height - 24,
    size: 11,
    font: fonts.serif,
    color: rgb(0.957, 0.937, 0.902),
  })
  page.drawText(type === 'renta' ? 'Arrendamiento' : 'Compraventa', {
    x: width - MARGIN - 90,
    y: height - 24,
    size: 9,
    font: fonts.sans,
    color: rgb(0.769, 0.647, 0.455),
  })
}

function drawFooter(page: PDFPage, font: PDFFont, index: number, total: number) {
  const { width } = page.getSize()
  page.drawLine({
    start: { x: MARGIN, y: FOOTER },
    end: { x: width - MARGIN, y: FOOTER },
    thickness: 0.5,
    color: rgb(0.769, 0.647, 0.455),
  })
  page.drawText('Borrador · No es un instrumento notarial', {
    x: MARGIN,
    y: 32,
    size: 8,
    font,
    color: rgb(0.36, 0.337, 0.306),
  })
  page.drawText(`${index} / ${total}`, {
    x: width - MARGIN - 24,
    y: 32,
    size: 8,
    font,
    color: rgb(0.36, 0.337, 0.306),
  })
}

export async function buildContractPdf(input: {
  type: ContractType
  title: string
  slots: Record<string, string>
  clauses: Clause[]
  footer?: DocumentFooter | null
  version: number
}): Promise<BuiltPdf> {
  const pdf = await PDFDocument.create()
  const serif = await pdf.embedFont(StandardFonts.TimesRoman)
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const sans = await pdf.embedFont(StandardFonts.Helvetica)
  const maxWidth = PAGE.width - MARGIN * 2
  const footer = resolveFooter(input.type, input.slots, input.footer)
  const heading = contractHeading(input.type, footer.heading)

  type Block =
    | { kind: 'title'; text: string }
    | { kind: 'clauseTitle'; text: string }
    | { kind: 'body'; text: string }
    | { kind: 'disclaimer'; text: string }
    | { kind: 'signGroup'; heading: string; names: string[] }

  const blocks: Block[] = [{ kind: 'title', text: heading }]

  for (const clause of input.clauses) {
    blocks.push({ kind: 'clauseTitle', text: clause.title.toUpperCase() })
    blocks.push({ kind: 'body', text: clause.body })
  }

  blocks.push({ kind: 'disclaimer', text: footer.disclaimer })
  blocks.push({
    kind: 'body',
    text: footer.closing,
  })
  const leftSigners = footer.leftSigners ?? []
  const rightSigners = footer.rightSigners ?? []
  if (!footer.leftHidden) {
    blocks.push({
      kind: 'signGroup',
      heading: pluralPartyLabel(footer.leftLabel, leftSigners.length),
      names: leftSigners.length ? leftSigners : [''],
    })
  }
  if (!footer.rightHidden) {
    blocks.push({
      kind: 'signGroup',
      heading: pluralPartyLabel(footer.rightLabel, rightSigners.length),
      names: rightSigners.length ? rightSigners : [''],
    })
  }

  const pages: PDFPage[] = []
  let page = pdf.addPage([PAGE.width, PAGE.height])
  pages.push(page)
  let y = PAGE.height - 64

  const ensure = (needed: number) => {
    if (y - needed > FOOTER + 16) return
    page = pdf.addPage([PAGE.width, PAGE.height])
    pages.push(page)
    y = PAGE.height - 64
  }

  for (const block of blocks) {
    if (block.kind === 'title') {
      const lines = wrap(block.text, serifBold, 16, maxWidth)
      ensure(lines.length * 20 + 8)
      for (const line of lines) {
        page.drawText(line, { x: MARGIN, y, size: 16, font: serifBold, color: rgb(0.078, 0.141, 0.122) })
        y -= 20
      }
      y -= 6
      page.drawLine({
        start: { x: MARGIN, y: y + 8 },
        end: { x: MARGIN + 120, y: y + 8 },
        thickness: 1.5,
        color: rgb(0.769, 0.647, 0.455),
      })
      y -= 10
      continue
    }
    if (block.kind === 'clauseTitle') {
      ensure(28)
      y -= 6
      page.drawText(toWinAnsi(block.text), {
        x: MARGIN,
        y,
        size: 11,
        font: serifBold,
        color: rgb(0.078, 0.141, 0.122),
      })
      y -= 16
      continue
    }
    if (block.kind === 'signGroup') {
      const col = maxWidth / 2
      const rows = Math.max(1, Math.ceil(block.names.length / 2))
      ensure(28 + rows * 52)
      y -= 16
      page.drawText(toWinAnsi(block.heading), {
        x: MARGIN,
        y,
        size: 9,
        font: serifBold,
        color: rgb(0.078, 0.141, 0.122),
      })
      y -= 28
      for (let i = 0; i < block.names.length; i += 2) {
        const left = block.names[i]
        const right = block.names[i + 1]
        page.drawLine({
          start: { x: MARGIN, y },
          end: { x: MARGIN + col - 24, y },
          thickness: 0.7,
          color: rgb(0.2, 0.2, 0.2),
        })
        if (right) {
          page.drawLine({
            start: { x: MARGIN + col, y },
            end: { x: MARGIN + maxWidth, y },
            thickness: 0.7,
            color: rgb(0.2, 0.2, 0.2),
          })
        }
        y -= 14
        if (left) {
          page.drawText(toWinAnsi(left), { x: MARGIN, y, size: 9, font: serifBold })
        }
        if (right) {
          page.drawText(toWinAnsi(right), { x: MARGIN + col, y, size: 9, font: serifBold })
        }
        y -= 28
      }
      continue
    }
    const size = block.kind === 'disclaimer' ? 8 : 10
    const regular = block.kind === 'disclaimer' ? sans : serif
    const color =
      block.kind === 'disclaimer' ? rgb(0.42, 0.39, 0.36) : rgb(0.11, 0.1, 0.09)
    const lines = wrapRuns(splitEmphasis(block.text), regular, serifBold, size, maxWidth)
    for (const line of lines) {
      ensure(size + 5)
      let x = MARGIN
      for (const part of line) {
        const font = part.emphasize ? serifBold : regular
        const drawn = safeText(part.text, font, size)
        page.drawText(drawn, { x, y, size, font, color })
        x += font.widthOfTextAtSize(drawn, size)
      }
      y -= size + 4
    }
    y -= block.kind === 'disclaimer' ? 10 : 8
  }

  const total = pages.length
  pages.forEach((p, i) => {
    drawHeader(p, { serif: serifBold, sans }, input.type)
    drawFooter(p, sans, i + 1, total)
  })

  const bytes = await pdf.save()
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return { bytes, base64: btoa(binary) }
}
