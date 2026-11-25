export interface PdfSection {
  heading?: string;
  lines: string[];
}

export interface PdfDocumentInput {
  title: string;
  subtitle?: string;
  metadata?: string[];
  sections: PdfSection[];
  footer?: string;
}

function escapePdfText(input: string): string {
  // Strip non-printable/non-ASCII characters cleanly to keep Helvetica Type1 encoding valid
  const ascii = input.replace(/[^\x20-\x7E]/g, ' ');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(text: string, maxChars = 92): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [''];
}

/**
 * Generates a valid multi-page PDF 1.4 buffer using standard Helvetica & Courier fonts
 * with zero external dependencies.
 */
export function buildPdfDocument(doc: PdfDocumentInput): Buffer {
  const pageWidth = 595; // A4 portrait points
  const pageHeight = 842;
  const marginX = 42;
  const topY = 795;
  const bottomY = 52;
  const lineHeight = 14;

  type DrawOp = { text: string; font: 'F1' | 'F2' | 'F3'; size: number; yGap: number };
  const ops: DrawOp[] = [];

  ops.push({ text: doc.title, font: 'F2', size: 16, yGap: 20 });
  if (doc.subtitle) {
    for (const line of wrapLine(doc.subtitle, 85)) {
      ops.push({ text: line, font: 'F1', size: 10, yGap: 14 });
    }
  }
  if (doc.metadata && doc.metadata.length > 0) {
    ops.push({ text: '', font: 'F1', size: 10, yGap: 6 });
    for (const meta of doc.metadata) {
      for (const line of wrapLine(meta, 90)) {
        ops.push({ text: line, font: 'F1', size: 9.5, yGap: 13 });
      }
    }
  }

  ops.push({ text: '-'.repeat(92), font: 'F3', size: 9, yGap: 14 });

  for (const section of doc.sections) {
    if (section.heading) {
      ops.push({ text: '', font: 'F1', size: 10, yGap: 6 });
      ops.push({ text: section.heading, font: 'F2', size: 11, yGap: 16 });
    }
    for (const rawLine of section.lines) {
      for (const line of wrapLine(rawLine, 92)) {
        ops.push({ text: line, font: 'F3', size: 9, yGap: lineHeight });
      }
    }
  }

  if (doc.footer) {
    ops.push({ text: '', font: 'F1', size: 9, yGap: 10 });
    ops.push({ text: '-'.repeat(92), font: 'F3', size: 9, yGap: 14 });
    ops.push({ text: doc.footer, font: 'F1', size: 8.5, yGap: 12 });
  }

  // Paginate ops
  const pages: string[] = [];
  let currentCommands: string[] = [];
  let cursorY = topY;

  for (const op of ops) {
    if (cursorY - op.yGap < bottomY && currentCommands.length > 0) {
      pages.push(currentCommands.join('\n'));
      currentCommands = [];
      cursorY = topY;
    }
    if (op.text.length > 0) {
      currentCommands.push(
        `BT /${op.font} ${op.size} Tf 1 0 0 1 ${marginX} ${cursorY} Tm (${escapePdfText(op.text)}) Tj ET`,
      );
    }
    cursorY -= op.yGap;
  }
  if (currentCommands.length > 0 || pages.length === 0) {
    pages.push(currentCommands.join('\n'));
  }

  // Assemble PDF objects
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const fontMonoId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  const pageIds: number[] = [];
  const pagesCatalogId = objects.length + 1 + pages.length * 2;

  for (const streamContent of pages) {
    const streamBytes = Buffer.byteLength(streamContent, 'utf8');
    const contentId = addObject(
      `<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesCatalogId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontMonoId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  const kidsRef = pageIds.map((id) => `${id} 0 R`).join(' ');
  const actualPagesId = addObject(
    `<< /Type /Pages /Kids [${kidsRef}] /Count ${pageIds.length} >>`,
  );
  const catalogId = addObject(`<< /Type /Catalog /Pages ${actualPagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
