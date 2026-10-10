import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TRANSITIONS, reasonRequired, type Status } from '@fit/shared';
import { fetchServerReport, sendTransition, type Identity, type ServerReport } from '../api';
import { getLocalEvents, getLocalReport } from '../reportService';
import { retryFailed, syncNow } from '../syncEngine';
import { CATEGORY_LABELS } from '../labels';
import { PriorityBadge, StatusBadge, SyncBadge } from '../components/Badges';

interface Props {
  id: string;
  identity: Identity;
  online: boolean;
  initial?: ServerReport; // the coordinator list passes its copy, so something shows offline
  onBack: () => void;
}

interface TimelineItem {
  key: string;
  at: string;
  source: 'Device' | 'Server';
  text: string;
  detail?: string;
}

const EVENT_TEXT: Record<string, string> = {
  created: 'Report created',
  edited: 'Draft edited',
  submitted: 'Submitted and queued for upload',
  synced: 'Synced to the server',
  sync_retry: 'Upload failed, will retry',
  sync_failed: 'Sync failed',
  sync_recovered: 'Interrupted upload queued again',
  sync_retry_requested: 'Retry requested',
  status_updated: 'Status updated from the server',
};

function eventText(type: string, from?: string | null, to?: string | null): string {
  if (type === 'status_changed') return `Status changed: ${from ?? '?'} → ${to ?? '?'}`;
  if (type === 'transition_rejected') return `Change refused: ${from ?? '?'} → ${to ?? '?'}`;
  return EVENT_TEXT[type] ?? type;
}

function detailText(details: unknown): string | undefined {
  if (!details) return undefined;
  if (typeof details === 'string') return details;
  if (typeof details === 'object') {
    const d = details as { reason?: unknown; message?: unknown };
    if (typeof d.reason === 'string') return `Reason: ${d.reason}`;
    if (typeof d.message === 'string') return d.message;
  }
  return undefined;
}

function place(text?: string | null, lat?: number | null, lng?: number | null): string {
  if (text) return text;
  if (lat != null && lng != null) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return 'No location';
}

function actionLabel(from: string, to: Status): string {
  if (from === 'Resolved') return 'Reopen';
  if (to === 'Rejected') return 'Reject';
  return `Move to ${to}`;
}

export function ReportDetails({ id, identity, online, initial, onBack }: Props) {
  const local = useLiveQuery(() => getLocalReport(id), [id]);
  const localEvents = useLiveQuery(() => getLocalEvents(id), [id], []);
  const [server, setServer] = useState<ServerReport | null>(initial ?? null);
  const [target, setTarget] = useState<Status | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setServer(await fetchServerReport(id));
    } catch {
      // A report that has not synced yet does not exist on the server. That is normal.
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, online]);

  // The server copy is newer when we have one; otherwise show what is on this device.
  const shown = server
    ? {
        category: server.category,
        description: server.description,
        priority: server.priority,
        status: server.status,
        where: place(server.locationText, server.latitude, server.longitude),
        reportedAt: server.reportedAt,
        ticketNo: server.ticketNo,
      }
    : local
      ? {
          category: local.category,
          description: local.description,
          priority: local.priority,
          status: local.workflowStatus,
          where: place(local.locationText, local.latitude, local.longitude),
          reportedAt: local.reportedAt,
          ticketNo: local.ticketNo,
        }
      : null;

  const timeline: TimelineItem[] = [
    ...localEvents.map((e) => ({
      key: `d${e.id}`,
      at: e.at,
      source: 'Device' as const,
      text: eventText(e.type),
      detail: detailText(e.details),
    })),
    ...(server?.events ?? [])
      // The device already shows its own "created" entry.
      .filter((e) => !(localEvents.length > 0 && e.type === 'created'))
      .map((e) => ({
        key: `s${e.id}`,
        at: e.occurredAt,
        source: 'Server' as const,
        text: eventText(e.type, e.fromStatus, e.toStatus),
        detail: detailText(e.details),
      })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const isCoordinator = identity.role === 'coordinator';
  const allowed: readonly Status[] = server ? (TRANSITIONS[server.status as Status] ?? []) : [];

  function choose(to: Status) {
    if (!server) return;
    setMessage('');
    if (reasonRequired(server.status as Status, to)) {
      setTarget(to);
      setReason('');
    } else {
      void change(to);
    }
  }

  async function change(to: Status, why?: string) {
    if (!server) return;
    setBusy(true);
    setMessage('');
    const outcome = await sendTransition(server.id, to, server.version, why);
    if (outcome.kind === 'ok') {
      setServer(outcome.report);
      setTarget(null);
      setReason('');
    } else {
      setMessage(outcome.message);
    }
    await load(); // always show the latest version and history
    setBusy(false);
  }

  async function handleRetry() {
    await retryFailed(id);
    await syncNow();
  }

  return (
    <section className="details">
      <button type="button" className="link back" onClick={onBack}>← Back to reports</button>

      {!shown ? (
        <p className="muted">Loading report...</p>
      ) : (
        <>
          <h2>
            {CATEGORY_LABELS[shown.category] ?? 'Report'}
            {shown.ticketNo ? ` · WS-${String(shown.ticketNo).padStart(4, '0')}` : ''}
          </h2>

          <div className="card-badges">
            <StatusBadge status={shown.status} />
            <PriorityBadge priority={shown.priority} />
            {local && <SyncBadge state={local.syncState} />}
          </div>

          <p className="card-desc">{shown.description}</p>
          <p className="muted">Location: {shown.where}</p>
          <p className="muted">Reported: {new Date(shown.reportedAt).toLocaleString()}</p>

          {local?.syncState === 'failed' && (
            <div className="notice">
              <p>{local.lastError ?? 'The report could not be synced.'}</p>
              <button type="button" onClick={handleRetry}>Retry sync</button>
            </div>
          )}
          {local && (local.syncState === 'pending' || local.syncState === 'syncing') && (
            <p className="notice">This report is saved on your device and will upload when you are online.</p>
          )}

          {isCoordinator && server && (
            <div className="actions-box">
              {!online && <p className="muted">You are offline. Status changes need a connection.</p>}
              {allowed.length === 0 ? (
                <p className="muted">No further status changes are possible from {server.status}.</p>
              ) : (
                <div className="actions">
                  {allowed.map((to) => (
                    <button
                      key={to}
                      type="button"
                      className={to === 'Rejected' ? 'danger' : ''}
                      disabled={!online || busy}
                      onClick={() => choose(to)}
                    >
                      {actionLabel(server.status, to)}
                    </button>
                  ))}
                </div>
              )}

              {target && (
                <div className="reason">
                  <label>
                    Reason for moving to {target}
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="secondary" onClick={() => setTarget(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" disabled={!reason.trim() || busy} onClick={() => void change(target, reason)}>
                      Confirm
                    </button>
                  </div>
                </div>
              )}
              {message && <p className="notice">{message}</p>}
            </div>
          )}
          {!isCoordinator && shown.status !== 'Draft' && (
            <p className="muted">Only a coordinator can change the status of a submitted report.</p>
          )}

          <h3>History</h3>
          <ul className="timeline">
            {timeline.map((item) => (
              <li key={item.key}>
                <span className="when">
                  {new Date(item.at).toLocaleString()} · {item.source}
                </span>
                <div>{item.text}</div>
                {item.detail && <div className="muted">{item.detail}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}