/**
 * Geração de CSV compatível com Excel pt-BR (separador ";" e BOM UTF-8),
 * com proteção contra CSV/Formula Injection (OWASP): células iniciadas por
 * = + - @ TAB ou CR recebem um apóstrofo para não serem interpretadas como fórmula.
 */
export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | Date | null | undefined;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/u;
/** BOM para o Excel reconhecer UTF-8 (acentos). */
const UTF8_BOM = String.fromCharCode(0xfeff);

export function escapeCsvCell(raw: string | number | boolean | Date | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let text: string;
  if (raw instanceof Date) text = raw.toISOString();
  else if (typeof raw === 'number') text = Number.isFinite(raw) ? String(raw).replace('.', ',') : '';
  else text = String(raw);

  if (typeof raw === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[";\n\r]/u.test(text)) text = `"${text.replace(/"/gu, '""')}"`;
  return text;
}

export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [columns.map((column) => escapeCsvCell(column.header)).join(';')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(column.value(row))).join(';'));
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
