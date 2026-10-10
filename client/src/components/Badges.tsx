import type { SyncState } from '../localDb';

const SYNC_LABELS: Record<SyncState, string> = {
  local: 'Draft on this device',
  pending: '⏳ Not synced',
  syncing: '🔄 Syncing...',
  synced: '✅ Synced',
  failed: '⚠️ Sync failed',
};

export function SyncBadge({ state }: { state: SyncState }) {
  return <span className={`badge sync-${state}`}>{SYNC_LABELS[state]}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className="badge status">{status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`badge priority-${priority || 'none'}`}>{priority || 'No priority'}</span>;
}