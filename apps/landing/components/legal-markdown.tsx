import type { ReactNode } from "react";

type LegalMarkdownProps = {
  content: string;
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;

      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={key}
            className="rounded bg-accent-soft px-1.5 py-0.5 text-[0.92em] text-accent"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold text-text">
            {part.slice(2, -2)}
          </strong>
        );
      }

      return part;
    });
}

function renderParagraph(lines: string[], key: string) {
  return (
    <p key={key} className="leading-[1.85] text-text-muted">
      {lines.map((line, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 ? <br /> : null}
          {renderInline(line.trim(), `${key}-inline-${index}`)}
        </span>
      ))}
    </p>
  );
}

function renderList(items: string[], key: string) {
  return (
    <ul key={key} className="space-y-2.5 pl-5 text-text-muted">
      {items.map((item, index) => (
        <li key={`${key}-${index}`} className="list-disc leading-[1.75]">
          {renderInline(item.trim(), `${key}-inline-${index}`)}
        </li>
      ))}
    </ul>
  );
}

function parseTableRow(line: string): string[] {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function isTableDivider(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function renderTable(lines: string[], key: string) {
  const rows = lines.map(parseTableRow);
  const hasHeader = rows.length >= 2 && isTableDivider(lines[1]);
  const headerRow = hasHeader ? rows[0] : null;
  const bodyRows = hasHeader ? rows.slice(2) : rows;

  return (
    <div key={key} className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[14.5px] text-text-muted">
        {headerRow ? (
          <thead>
            <tr>
              {headerRow.map((cell, index) => (
                <th
                  key={`${key}-th-${index}`}
                  className="border-b border-line px-3 py-2.5 align-top font-semibold text-text"
                >
                  {renderInline(cell, `${key}-th-${index}`)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`${key}-tr-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`${key}-td-${rowIndex}-${cellIndex}`}
                  className="border-b border-line px-3 py-2.5 align-top leading-[1.7]"
                >
                  {renderInline(cell, `${key}-td-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalMarkdown({ content }: LegalMarkdownProps) {
  const blocks: ReactNode[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  const tableLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(renderParagraph([...paragraph], `paragraph-${blocks.length}`));
    paragraph.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(renderList([...listItems], `list-${blocks.length}`));
    listItems.length = 0;
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    blocks.push(renderTable([...tableLines], `table-${blocks.length}`));
    tableLines.length = 0;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushParagraph();
      flushTable();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushList();
      flushParagraph();
      flushTable();
      blocks.push(
        <h1
          key={`heading-${blocks.length}`}
          className="text-balance text-[34px] font-extrabold leading-tight tracking-normal text-text md:text-[44px]"
        >
          {renderInline(trimmed.slice(2), `heading-${blocks.length}`)}
        </h1>,
      );
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushList();
      flushParagraph();
      flushTable();
      blocks.push(
        <h2
          key={`heading-${blocks.length}`}
          className="pt-6 text-[22px] font-bold leading-tight tracking-normal text-text"
        >
          {renderInline(trimmed.slice(3), `heading-${blocks.length}`)}
        </h2>,
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      flushParagraph();
      flushTable();
      blocks.push(
        <h3
          key={`heading-${blocks.length}`}
          className="pt-2 text-[17px] font-semibold leading-tight tracking-normal text-text"
        >
          {renderInline(trimmed.slice(4), `heading-${blocks.length}`)}
        </h3>,
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      flushTable();
      listItems.push(trimmed.slice(2));
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushParagraph();
      flushList();
      tableLines.push(trimmed);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(trimmed);
  }

  flushList();
  flushParagraph();
  flushTable();

  return <article className="space-y-6">{blocks}</article>;
}
