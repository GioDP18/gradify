import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Skeleton } from './States';

/**
 * Reusable data table.
 *  - columns: [{ key, header, label?, sortable?, render?(row), className?, hideLabel? }]
 *    (`label` = plain-text name when `header` is JSX)
 *  - sort: { field, order } + onSortChange(field)
 *  - selection (optional): selectedIds (Set) + onSelectionChange(Set)
 * On narrow screens rows collapse into labelled cards (no horizontal scrolling).
 */
export default function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  loading = false,
  empty,
  caption,
  rowClassName,
  rowLabel,
}) {
  const selectable = Boolean(onSelectionChange);
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedIds.has(rowKey(row)));
  const someSelected = selectable && rows.some((row) => selectedIds.has(rowKey(row)));
  const headerCheckbox = useRef(null);

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const toggleAll = () => {
    const next = new Set(selectedIds);
    rows.forEach((row) => (allSelected ? next.delete(rowKey(row)) : next.add(rowKey(row))));
    onSelectionChange(next);
  };
  const toggleOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const ariaSort = (column) => {
    if (!column.sortable || sort?.field !== column.key) return undefined;
    return sort.order === 'desc' ? 'descending' : 'ascending';
  };

  return (
    <div className="evsu-table-wrap">
      <table className="table evsu-table mb-0" aria-busy={loading}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="evsu-table__check">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  className="form-check-input"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all rows on this page"
                  disabled={rows.length === 0}
                />
              </th>
            )}
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.className} aria-sort={ariaSort(column)} aria-label={column.label}>
                {column.sortable && onSortChange ? (
                  <button type="button" className="evsu-sort-btn" onClick={() => onSortChange(column.key)}>
                    {column.header}
                    {sort?.field === column.key ? (
                      sort.order === 'desc' ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <ArrowUpDown size={14} aria-hidden="true" className="opacity-50" />
                    )}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* While loading, skeleton rows replace any rows already shown (a refresh keeps the old rows cached). */}
          {loading &&
            Array.from({ length: 5 }, (_, i) => (
              <tr key={`skeleton-${i}`}>
                {selectable && <td />}
                {columns.map((column) => (
                  <td key={column.key}><Skeleton width={`${50 + ((i * 17 + column.key.length * 7) % 40)}%`} /></td>
                ))}
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr className="evsu-table__empty">
              <td colSpan={columns.length + (selectable ? 1 : 0)}>{empty}</td>
            </tr>
          )}
          {!loading && rows.map((row) => {
            const id = rowKey(row);
            const selected = selectable && selectedIds.has(id);
            return (
              <tr key={id} className={`${selected ? 'is-selected' : ''} ${rowClassName?.(row) ?? ''}`}>
                {selectable && (
                  <td className="evsu-table__check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={selected}
                      onChange={() => toggleOne(id)}
                      aria-label={`Select ${rowLabel ? rowLabel(row) : `row ${id}`}`}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={column.className} data-label={column.hideLabel ? undefined : column.label ?? column.header}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
