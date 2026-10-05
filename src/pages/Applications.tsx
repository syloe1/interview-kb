import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { Breadcrumb } from '../components/common/Breadcrumb';
import applicationsUrl from '../content/knowledge/interview/找工作.xls?url';

// 单元格原始值：Excel 里可能是字符串、数字或日期
type CellValue = string | number | boolean | Date | null | undefined;
// 一个工作表整理后的形态
interface SheetTable {
  name: string;
  caption: string; // 合并单元格里的表标题，例如「秋招」
  header: string[];
  rows: string[][];
}
// 模块级缓存：切走再切回来不用重新下载和解析
let sheetPromise: Promise<SheetTable[]> | undefined;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// 把 9/8/26、2026/9/8 这类日期文本统一成 2026-09-08
function normalizeDateText(text: string): string {
  const yearFirst = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yearFirst) {
    return `${yearFirst[1]}-${pad2(Number(yearFirst[2]))}-${pad2(Number(yearFirst[3]))}`;
  }
  // Excel 默认按「月/日/年」输出，两位数年份补成 20xx
  const monthFirst = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (monthFirst) {
    const year = monthFirst[3].length === 2 ? `20${monthFirst[3]}` : monthFirst[3];
    return `${year}-${pad2(Number(monthFirst[1]))}-${pad2(Number(monthFirst[2]))}`;
  }
  return text;
}

// 把 Excel 单元格转成能直接渲染的字符串
function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (typeof value === 'string') return normalizeDateText(value);
  return String(value);
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell === '');
}

// 把二维数组整理成「标题 + 表头 + 数据行」
function toSheetTable(name: string, rawRows: CellValue[][]): SheetTable | undefined {
  const rows = rawRows
    .map((row) => row.map(formatCell))
    .filter((row) => !isEmptyRow(row));
  if (rows.length === 0) return undefined;

  let caption = '';
  let body = rows;
  const [first] = rows;
  const filled = first.filter((cell) => cell !== '').length;
  // 首行只有一个非空单元格时，把它当合并单元格标题（如「秋招」），下一行才是表头
  if (filled === 1 && first.length > 1) {
    caption = first.find((cell) => cell !== '') ?? '';
    body = rows.slice(1);
  }

  if (body.length === 0) return undefined;

  // 首行不含数字才当表头（如「日期 / 做了 / plan」）；
  // 含数字说明已经是数据行（如「9月16 / 安建大校招」），这张表就没有表头
  const [firstBodyRow] = body;
  const hasHeader =
    firstBodyRow.some((cell) => cell !== '') &&
    firstBodyRow.every((cell) => !/\d/.test(cell));

  const width = Math.max(...body.map((row) => row.length));
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_, index) => row[index] ?? '');

  return {
    name,
    caption,
    header: hasHeader ? pad(firstBodyRow) : [],
    rows: (hasHeader ? body.slice(1) : body).map(pad),
  };
}

async function loadSheets(url: string): Promise<SheetTable[]> {
  // 只在打开这个页面时才加载解析库，避免拖慢首屏
  const XLSX = await import('xlsx');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败：${response.status} ${response.statusText}`);
  }

  const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    // raw: false 取单元格的显示文本，日期才会是 9/8/26 而不是 46273 这样的序列号
    const rows = sheet
      ? (XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          blankrows: false,
          raw: false,
        }) as CellValue[][])
      : [];
    return toSheetTable(name, rows);
  }).filter((table): table is SheetTable => table !== undefined);
}

export function Applications() {
  const [sheets, setSheets] = useState<SheetTable[]>([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let isCurrent = true;
    sheetPromise ??= loadSheets(applicationsUrl);

    sheetPromise
      .then((tables) => {
        if (!isCurrent) return;
        setSheets(tables);
        setActiveSheet(tables[0]?.name ?? '');
      })
      .catch((error: unknown) => {
        // 解析失败时清掉缓存，下次进入页面可以重试
        sheetPromise = undefined;
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : '表格解析失败。');
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const current = sheets.find((sheet) => sheet.name === activeSheet) ?? sheets[0];

  return (
    <div>
      <Breadcrumb items={[{ label: '投递情况' }]} />

      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <FileSpreadsheet size={17} aria-hidden="true" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
              Spreadsheet
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[var(--text-primary)]">
            投递情况
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            秋招投递记录和每日进展，页面直接读取 Excel 渲染。
          </p>
        </div>
        <a
          href={applicationsUrl}
          download
          className="inline-flex h-9 shrink-0 items-center gap-2 border border-[var(--border)] bg-[var(--card-bg)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
        >
          <Download size={14} aria-hidden="true" /> 下载原表格
        </a>
      </div>

      {isLoading && (
        <p className="py-16 text-center text-sm text-[var(--text-faint)]">
          正在读取表格…
        </p>
      )}

      {loadError && (
        <div className="mt-7 flex items-start gap-2 border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      {!isLoading && !loadError && sheets.length === 0 && (
        <p className="py-16 text-center text-sm text-[var(--text-faint)]">
          表格里没有可显示的数据。
        </p>
      )}

      {!isLoading && !loadError && current && (
        <>
          {sheets.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {sheets.map((sheet) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheet(sheet.name)}
                  className={`border px-3 py-1.5 font-mono text-xs transition-colors ${
                    sheet.name === current.name
                      ? 'border-[var(--border-active)] bg-[var(--card-bg-active)] text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-muted)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {sheet.name}
                  <span className="ml-2 text-[var(--text-faint)]">
                    {sheet.rows.length}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 border border-[var(--border)] bg-[var(--card-bg)]">
            {current.caption && (
              <p className="border-b border-[var(--border)] bg-[var(--hover-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)]">
                {current.caption}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
                {current.header.length > 0 && (
                  <thead>
                    <tr>
                      {current.header.map((cell, column) => (
                        <th
                          key={column}
                          className="border-b border-[var(--border)] bg-[var(--hover-bg)] px-3 py-2 text-left font-semibold whitespace-nowrap text-[var(--text-secondary)]"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {current.rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-b border-[var(--border-light)] last:border-0"
                    >
                      {row.map((cell, column) => (
                        <td
                          key={column}
                          className="px-3 py-2 align-top text-[var(--text-muted)]"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
