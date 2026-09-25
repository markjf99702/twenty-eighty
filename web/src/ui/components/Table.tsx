import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { GLOSSARY } from "../format";

export interface Column<T> {
  key: string;
  label: string;
  title?: string;
  /** Sort value; columns without one aren't sortable. */
  sort?: (r: T) => number | string;
  /** Sort ascending on first click (ERA, names); numbers default to descending. */
  asc?: boolean;
  render: (r: T) => ComponentChildren;
  cls?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string | number;
  sortKey?: string;
  sortAsc?: boolean;
  rowClass?: (r: T, i: number) => string;
  /** Rows shown before "Show all". */
  limit?: number;
  /** Extra row rendered under a row (roster moves). */
  expanded?: (r: T) => ComponentChildren | null;
  ranked?: boolean;
  empty?: string;
}

export function Table<T>(props: Props<T>) {
  const { columns, rows, rowKey, rowClass, expanded, ranked } = props;
  const [sort, setSort] = useState<{ key: string | undefined; asc: boolean }>({ key: props.sortKey, asc: props.sortAsc ?? false });
  const [all, setAll] = useState(false);

  const col = columns.find((c) => c.key === sort.key);
  let sorted = rows;
  if (col?.sort) {
    const by = col.sort;
    sorted = [...rows].sort((a, b) => {
      const va = by(a);
      const vb = by(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.asc ? cmp : -cmp;
    });
  }
  const limit = props.limit && !all ? props.limit : Infinity;
  const shown = sorted.slice(0, limit);

  const click = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: Boolean(c.asc) }));
  };

  if (rows.length === 0) return <div class="empty">{props.empty ?? "Nothing here yet."}</div>;

  return (
    <div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              {ranked && <th class="rank num">#</th>}
              {columns.map((c) => (
                <th
                  key={c.key}
                  class={`${c.cls ?? ""}${sort.key === c.key ? " sorted" : ""}`}
                  title={c.title ?? GLOSSARY[c.label]}
                  aria-sort={sort.key === c.key ? (sort.asc ? "ascending" : "descending") : undefined}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => click(c)}>
                      {c.label}
                      {sort.key === c.key ? (sort.asc ? " ▲" : " ▼") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const extra = expanded?.(r);
              return [
                <tr key={rowKey(r)} class={rowClass?.(r, i) ?? ""}>
                  {ranked && <td class="rank num">{i + 1}</td>}
                  {columns.map((c) => (
                    <td key={c.key} class={c.cls ?? ""}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>,
                extra ? (
                  <tr key={`${rowKey(r)}-x`} class="expand">
                    <td colSpan={columns.length + (ranked ? 1 : 0)}>{extra}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > shown.length && (
        <div class="tbl-more">
          <button type="button" class="btn ghost" onClick={() => setAll(true)}>
            Show all {sorted.length}
          </button>
        </div>
      )}
    </div>
  );
}
