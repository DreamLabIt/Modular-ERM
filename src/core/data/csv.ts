import { ValidationError } from '@/core/errors';

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 100;
export const MAX_CELL_LENGTH = 2000;

/**
 * Strict CSV parser with quote handling and limits. It deliberately does not
 * evaluate formulas or HTML; imported values remain inert strings.
 */
export function parseCsv(text: string, options?: { maxRows?: number }): ParsedTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const maxRows = Math.min(options?.maxRows ?? MAX_IMPORT_ROWS, MAX_IMPORT_ROWS);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
      if (records.length > maxRows + 1) {
        throw new ValidationError(`CSV exceeds the maximum of ${maxRows} data rows.`);
      }
    } else if (char === '\r') {
      // Ignore CR; LF terminates the record.
    } else {
      cell += char;
    }
  }

  if (inQuotes) throw new ValidationError('CSV contains an unterminated quoted value.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  const nonEmpty = records.filter((record) => record.some((value) => value.trim() !== ''));
  if (nonEmpty.length === 0) throw new ValidationError('The uploaded file is empty.');

  const rawHeaders = nonEmpty[0].map((header) => header.trim());
  if (rawHeaders.length > MAX_IMPORT_COLUMNS) {
    throw new ValidationError(`CSV exceeds the maximum of ${MAX_IMPORT_COLUMNS} columns.`);
  }
  if (rawHeaders.some((header) => !header)) {
    throw new ValidationError('Every CSV column must have a header.');
  }
  const headers = rawHeaders.map(normalizeHeader);
  if (new Set(headers).size !== headers.length) {
    throw new ValidationError('CSV headers must be unique.');
  }

  const rows = nonEmpty.slice(1).map((record) => {
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = (record[index] ?? '').trim();
      if (value.length > MAX_CELL_LENGTH) {
        throw new ValidationError(`A cell exceeds the maximum length of ${MAX_CELL_LENGTH} characters.`);
      }
      mapped[header] = value;
    });
    return mapped;
  });

  return { headers, rows };
}

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function detectFileFormat(fileName: string, mimeType?: string): 'CSV' | 'XLSX' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || mimeType === 'text/csv') return 'CSV';
  if (
    lower.endsWith('.xlsx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'XLSX';
  }
  throw new ValidationError('Only CSV and XLSX files are supported.');
}
