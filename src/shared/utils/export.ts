export type ExportCell = string | number | boolean | Date | null | undefined;

function normalizeCell(value: ExportCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Neutralizes spreadsheet formula injection when values start with =, +, -, @, tab, or CR.
 */
function sanitizeFormulaCell(text: string): string {
  if (/^[=+\-@\t\r]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

function escapeCsvField(value: ExportCell): string {
  const raw = sanitizeFormulaCell(normalizeCell(value));
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildCsv(headers: string[], rows: ExportCell[][]): string {
  const headerLine = headers.map((h) => escapeCsvField(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => escapeCsvField(cell)).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds an Excel-compatible SpreadsheetML 2003 (.xls) workbook with zero external dependencies.
 */
export function buildExcelWorkbook(
  sheetName: string,
  headers: string[],
  rows: ExportCell[][],
): string {
  const safeSheet = escapeXml(sheetName.slice(0, 31) || 'Report');
  const headerXml = headers
    .map(
      (h) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(sanitizeFormulaCell(h))}</Data></Cell>`,
    )
    .join('');

  const rowsXml = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
          }
          const text = sanitizeFormulaCell(normalizeCell(cell));
          return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${safeSheet}">
    <Table>
      <Row>${headerXml}</Row>
      ${rowsXml}
    </Table>
  </Worksheet>
</Workbook>`;
}
