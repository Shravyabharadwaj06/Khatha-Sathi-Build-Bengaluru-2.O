import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../services/api';

interface SearchResponse {
  products: Array<{ id: string }>;
  customers: Array<{ id: string }>;
}

const DIGITS = /\D/g;

/**
 * Search box for the Products / Customers lists.
 * GET /search ranks by fuzzy name match and aliases ("namak" -> Tata Salt, "rmesh" -> Ramesh).
 * Plain substring and phone-number matches from the loaded list are added after the server's results,
 * because the server search does not look at phone numbers.
 * Returns the rows to show (all rows when the box is empty).
 */
export function useShopSearch<T extends { id: string; name: string }>(
  kind: 'products' | 'customers',
  rows: T[],
  query: string,
  phones: (row: T) => Array<string | null | undefined> = () => [],
) {
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const term = query.trim();

  useEffect(() => {
    if (!term) {
      setServerIds([]);
      setError('');
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      apiRequest<SearchResponse>(`/search?q=${encodeURIComponent(term)}`)
        .then((result) => {
          if (cancelled) return;
          setServerIds(result[kind].map((row) => row.id));
          setError('');
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setServerIds([]);
          setError(reason instanceof Error ? reason.message : 'Search failed.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, term]);

  const visible = useMemo(() => {
    if (!term) return rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const lower = term.toLowerCase();
    const digits = term.replace(DIGITS, '');
    const local = rows.filter(
      (row) =>
        row.name.toLowerCase().includes(lower) ||
        (digits.length >= 3 && phones(row).some((phone) => (phone ?? '').replace(DIGITS, '').includes(digits))),
    );
    const ordered = serverIds.map((id) => byId.get(id)).filter((row): row is T => row !== undefined);
    const seen = new Set(ordered.map((row) => row.id));
    return [...ordered, ...local.filter((row) => !seen.has(row.id))];
    // `phones` is a stable accessor in practice; leaving it out keeps the memo from re-running every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, serverIds, term]);

  return { visible, searching, error, active: term !== '' };
}
