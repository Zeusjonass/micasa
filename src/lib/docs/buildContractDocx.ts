import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { contractHeading } from '../contracts/heading'
import { pluralPartyLabel, resolveFooter, splitEmphasis } from '../contracts/emphasis'
import type { Clause, ContractType, DocumentFooter } from '../types'

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 80 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: 'Times New Roman',
        size: 22,
      }),
    ],
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160 },
    children: splitEmphasis(text).map(
      (run) =>
        new TextRun({
          text: run.text,
          bold: Boolean(run.emphasize),
          font: 'Times New Roman',
          size: 22,
        }),
    ),
  })
}

export async function buildContractDocx(input: {
  type: ContractType
  title: string
  slots?: Record<string, string>
  clauses: Clause[]
  footer?: DocumentFooter | null
  version: number
}): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `MiCasa  ·  Yucatán  ·  Borrador v${input.version}`,
          font: 'Times New Roman',
          size: 20,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: contractHeading(input.type),
          bold: true,
          font: 'Times New Roman',
          size: 28,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [
        new TextRun({
          text: input.title,
          italics: true,
          font: 'Times New Roman',
          size: 20,
          color: '555555',
        }),
      ],
    }),
  ]

  for (const clause of input.clauses) {
    children.push(heading(clause.title.toUpperCase()))
    children.push(body(clause.body))
  }

  children.push(
    new Paragraph({
      spacing: { before: 280 },
      children: [
        new TextRun({
          text: resolveFooter(input.type, input.slots ?? {}, input.footer).disclaimer,
          italics: true,
          font: 'Times New Roman',
          size: 16,
          color: '666666',
        }),
      ],
    }),
  )
  const footer = resolveFooter(input.type, input.slots ?? {}, input.footer)
  children.push(
    new Paragraph({
      spacing: { before: 360, after: 80 },
      children: [
        new TextRun({
          text: footer.closing,
          font: 'Times New Roman',
          size: 22,
        }),
      ],
    }),
  )
  for (const group of [
    { heading: pluralPartyLabel(footer.leftLabel, footer.leftSigners?.length || 0), names: footer.leftSigners ?? [] },
    { heading: pluralPartyLabel(footer.rightLabel, footer.rightSigners?.length || 0), names: footer.rightSigners ?? [] },
  ]) {
    if (group.names.length === 0) continue
    children.push(
      new Paragraph({
        spacing: { before: 320, after: 80 },
        children: [
          new TextRun({ text: group.heading, bold: true, font: 'Times New Roman', size: 20 }),
        ],
      }),
    )
    for (const name of group.names) {
      children.push(
        new Paragraph({
          spacing: { before: 280 },
          children: [
            new TextRun({
              text: name || '________________',
              bold: true,
              font: 'Times New Roman',
              size: 20,
            }),
          ],
        }),
      )
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 864, bottom: 720, left: 864 },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBlob(doc)
}

export function fileBase(title: string, version: number): string {
  return `${title.replaceAll(' ', '_')}_v${version}`
}
