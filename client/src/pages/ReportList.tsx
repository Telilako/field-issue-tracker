import { useState } from 'react';
import { STATUSES } from '@fit/shared';
import { useLocalReports } from '../hooks/useReports';
import { ReportCard } from '../components/ReportCard';

interface Props {
  onNew: () => void;
  onOpenDraft: (id: string) => void;
  onOpenReport: (id: string) => void;
}

export function ReportList({ onNew, onOpenDraft, onOpenReport }: Props) {
  const reports = useLocalReports();
  const [filter, setFilter] = useState('');

  const shown = filter ? reports.filter((r) => r.workflowStatus === filter) : reports;

  return (
    <section>
      <div className="toolbar">
        <button onClick={onNew}>+ New report</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          {reports.length === 0 ? 'No reports yet. Tap "New report" to create one.' : 'No reports match this filter.'}
        </p>
      ) : (
        <ul className="cards">
          {shown.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              onOpen={r.workflowStatus === 'Draft' ? () => onOpenDraft(r.id) : () => onOpenReport(r.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}