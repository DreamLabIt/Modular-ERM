import { inflateRawSync } from 'zlib';
import { ValidationError } from '@/core/errors';
import { normalizeHeader, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_CELL_LENGTH, type ParsedTable } from './csv';

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) return offset;
  }
  throw new ValidationError('The XLSX file is not a valid ZIP archive.');
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 22 || readUInt32(buffer, 0) !== 0x04034b50) {
    throw new ValidationError('The XLSX file is not a valid ZIP archive.');
  }
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = readUInt16(buffer, eocd + 10);
  if (entryCount <= 0 || entryCount > 10000) {
    throw new ValidationError('The XLSX archive has an invalid entry count.');
  }
  let offset = readUInt32(buffer, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || readUInt32(buffer, offset) !== 0x02014b50) {
      throw new ValidationError('The XLSX central directory is corrupted.');
    }
    const compression = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    entries.push({ name, compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  const result = new Map<string, Buffer>();
  for (const entry of entries) {
    const local = entry.localHeaderOffset;
    if (local + 30 > buffer.length || readUInt32(buffer, local) !== 0x04034b50) {
      throw new ValidationError('The XLSX local file header is corrupted.');
    }
    const fileNameLength = readUInt16(buffer, local + 26);
    const extraLength = readUInt16(buffer, local + 28);
    const dataStart = local + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) {
      throw new ValidationError('The XLSX entry exceeds the archive size.');
    }
    const raw = buffer.subarray(dataStart, dataEnd);
    if (entry.compression === 0) {
      result.set(entry.name, raw);
    } else if (entry.compression === 8) {
      try {
        result.set(entry.name, inflateRawSync(raw, { maxOutputLength: 20 * 1024 * 1024 }));
      } catch {
        throw new ValidationError('The XLSX archive contains an invalid compressed entry.');
      }
    } else {
      throw new ValidationError('The XLSX archive uses an unsupported compression method.');
    }
  }
  return result;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function allMatches(source: string, regex: RegExp): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  const pattern = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    results.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return results;
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let item: RegExpExecArray | null;
  while ((item = itemRegex.exec(xml))) {
    const texts = allMatches(item[1], /<t\b[^>]*>([\s\S]*?)<\/t>/g).map((match) => decodeXml(match[1]));
    strings.push(texts.join(''));
  }
  return strings;
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Z]/gi, '').toUpperCase();
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationError(`XLSX exceeds the maximum of ${MAX_IMPORT_ROWS} data rows.`);
    }
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/i.exec(attributes)?.[1] ?? '';
      const type = /t="([^"]+)"/i.exec(attributes)?.[1] ?? '';
      const index = reference ? columnIndex(reference) : cells.length;
      if (index >= MAX_IMPORT_COLUMNS) {
        throw new ValidationError(`XLSX exceeds the maximum of ${MAX_IMPORT_COLUMNS} columns.`);
      }
      let value = '';
      if (type === 'inlineStr') {
        value = allMatches(body, /<t\b[^>]*>([\s\S]*?)<\/t>/g).map((match) => decodeXml(match[1])).join('');
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/g.exec(body)?.[1] ?? '';
        value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeXml(raw);
      }
      value = value.trim();
      if (value.length > MAX_CELL_LENGTH) {
        throw new ValidationError(`A cell exceeds the maximum length of ${MAX_CELL_LENGTH} characters.`);
      }
      cells[index] = value;
    }
    rows.push(Array.from({ length: cells.length }, (_, index) => cells[index] ?? ''));
  }
  return rows;
}

/**
 * Minimal, dependency-free XLSX reader for the first worksheet. It supports
 * shared strings, inline strings, numbers, and booleans. Macros, external
 * links, and formulas are never evaluated.
 */
export function parseXlsx(buffer: Buffer): ParsedTable {
  if (buffer.length > 10 * 1024 * 1024) {
    throw new ValidationError('XLSX files must be 10 MB or smaller.');
  }
  const entries = readZipEntries(buffer);
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const firstSheetName = /<sheet\b[^>]*name="([^"]+)"/i.exec(workbook)?.[1];
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  let sheetPath = 'xl/worksheets/sheet1.xml';

  if (firstSheetName && relationships) {
    const relationshipRegex = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
    const sheetIdMatch = new RegExp(
      `<sheet\\b[^>]*name="${firstSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*r:id="([^"]+)"`,
      'i',
    ).exec(workbook);
    let match: RegExpExecArray | null;
    while ((match = relationshipRegex.exec(relationships))) {
      if (sheetIdMatch && match[1] === sheetIdMatch[1]) {
        sheetPath = `xl/${match[2].replace(/^\/?xl\//, '').replace(/^\//, '')}`;
        break;
      }
    }
  }

  const sheet = entries.get(sheetPath)?.toString('utf8') ?? entries.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheet) throw new ValidationError('The XLSX workbook does not contain a readable worksheet.');

  const sharedStrings = readSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const matrix = parseSheet(sheet, sharedStrings).filter((row) => row.some((value) => value.trim() !== ''));
  if (matrix.length === 0) throw new ValidationError('The XLSX worksheet is empty.');

  const headers = matrix[0].map((header) => normalizeHeader(header));
  if (headers.some((header) => !header)) {
    throw new ValidationError('Every XLSX column must have a header.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new ValidationError('XLSX headers must be unique.');
  }

  const rows = matrix.slice(1).map((row) => {
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      mapped[header] = (row[index] ?? '').trim();
    });
    return mapped;
  });

  return { headers, rows };
}
