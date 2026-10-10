import { useState } from 'react';
import { syncNow } from '../syncEngine';
import type { SyncCounts } from '../hooks/useReports';

const reports = (n: number) => `${n} report${n === 1 ? '' : 's'}`;

export function Banner({ online, counts }: { online: boolean; counts: SyncCounts }) {
  const [busy, setBusy] = useState(false);
  const waiting = counts.pending + counts.syncing;

  async function handleSync() {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  }

  let tone = '';
  let message = '';

  if (!online) {
    tone = 'offline';
    message =
      waiting > 0
        ? `You're offline. ${reports(waiting)} waiting to sync.`
        : "You're offline. New reports are saved on this device.";
  } else if (counts.failed > 0) {
    tone = 'failed';
    message = `${reports(counts.failed)} failed to sync. Open them to see why.`;
  } else if (busy || counts.syncing > 0) {
    tone = 'syncing';
    message = `Syncing ${reports(Math.max(waiting, 1))}...`;
  } else if (waiting > 0) {
    tone = 'waiting';
    message = `${reports(waiting)} waiting to sync.`;
  } else {
    return null;
  }

  return (
    <div className={`banner banner-${tone}`} role="status">
      <span>{message}</span>
      {online && waiting > 0 && (
        <button onClick={handleSync} disabled={busy}>
          {busy ? 'Syncing...' : 'Sync now'}
        </button>
      )}
    </div>
  );
}