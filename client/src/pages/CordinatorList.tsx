import { useCallback, useEffect, useState } from 'react';
import { STATUSES } from '@fit/shared';
import type { ServerReport } from '../api';
import { loadServerReports } from '../serverCache';
import { CATEGORY_LABELS } from '../labels';
import { PriorityBadge, StatusBadge } from '../components/Badges';

interface Props {
  online: boolean;
  onOpen: (report: ServerReport) => void;
}

export function CoordinatorList({ online, onOpen }: Props) {
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadServerReports();
    setReports(result.reports);
    setFromCache(result.fromCache);
    setCachedAt(result.cachedAt ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, online]);

  const shown = filter ? reports.filter((r) => r.status === filter) : reports;

  return (
    <section>
      <div className="toolbar">
        <button onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.filter((s) => s !== 'Draft').map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {fromCache && (
        <p className="notice">
          Showing the last list saved on this device
          {cachedAt ? ` (${new Date(cachedAt).toLocaleString()})` : ''}. Connect to refresh.
        </p>
      )}

      {shown.length === 0 && !loading ? (
        <p className="muted">
          {reports.length === 0 ? 'No reports have reached the server yet.' : 'No reports match this filter.'}
        </p>
      ) : (
        <ul className="cards">
          {shown.map((r) => (
            <li key={r.id} className="card clickable" onClick={() => onOpen(r)}>
              <div className="card-top">
                <strong>
                  {CATEGORY_LABELS[r.category] ?? r.category} · WS-{String(r.ticketNo).padStart(4, '0')}
                </strong>
                <PriorityBadge priority={r.priority} />
              </div>
              <p className="card-desc">{r.description}</p>
              <p className="muted">
                {r.locationText ?? 'GPS location'} · {new Date(r.reportedAt).toLocaleString()} · by {r.reportedBy}
              </p>
              <div className="card-badges">
                <StatusBadge status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}