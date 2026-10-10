import type { LocalReport } from '../localDb';
import { CATEGORY_LABELS } from '../labels';
import { PriorityBadge, StatusBadge, SyncBadge } from './Badges';

export function ReportCard({ report, onOpen }: { report: LocalReport; onOpen?: () => void }) {
  const place =
    report.locationText ??
    (report.latitude !== undefined && report.longitude !== undefined
      ? `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`
      : 'No location yet');

  return (
    <li className={`card ${onOpen ? 'clickable' : ''}`} onClick={onOpen}>
      <div className="card-top">
        <strong>{CATEGORY_LABELS[report.category] ?? 'No category yet'}</strong>
        <PriorityBadge priority={report.priority} />
      </div>
      <p className="card-desc">{report.description || 'No description yet'}</p>
      <p className="muted">
        {place} · {new Date(report.reportedAt).toLocaleString()}
        {report.ticketNo ? ` · WS-${String(report.ticketNo).padStart(4, '0')}` : ''}
      </p>
      <div className="card-badges">
        <StatusBadge status={report.workflowStatus} />
        <SyncBadge state={report.syncState} />
      </div>
      {report.lastError && <p className="error-text">{report.lastError}</p>}
    </li>
  );
}