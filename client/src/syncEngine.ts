import { db, type LocalReport } from './localDb';
import { sendReport, type SendOutcome } from './api';

export type Sender = (report: LocalReport) => Promise<SendOutcome>;

export interface SyncOptions {
  send?: Sender; // injected in tests
  force?: boolean; // true for "Sync now" and the online event: ignore backoff
  now?: () => number; // injected in tests
}

export interface SyncSummary {
  synced: number;
  retryLater: number;
  failed: number;
  skipped: number;
}

export const MAX_RETRIES = 5;
const SYNC_INTERVAL_MS = 30_000;

// 2s, 4s, 8s, 16s... capped at 60s.
export function backoffMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return Math.min(2000 * 2 ** (retryCount - 1), 60_000);
}

function isBackingOff(report: LocalReport, nowMs: number): boolean {
  if (report.retryCount === 0 || !report.lastAttemptAt) return false;
  return nowMs < Date.parse(report.lastAttemptAt) + backoffMs(report.retryCount);
}

function logEvent(reportId: string, type: string, details?: string) {
  return db.events.add({ reportId, type, at: new Date().toISOString(), details });
}

// Pending -> syncing in one atomic step. If another run or tab already took it, returns undefined.
async function claim(id: string, at: string): Promise<LocalReport | undefined> {
  return db.transaction('rw', db.reports, async () => {
    const report = await db.reports.get(id);
    if (!report || report.syncState !== 'pending') return undefined;
    await db.reports.update(id, { syncState: 'syncing', lastAttemptAt: at });
    return { ...report, syncState: 'syncing' as const, lastAttemptAt: at };
  });
}

async function applyOutcome(report: LocalReport, outcome: SendOutcome, summary: SyncSummary) {
  await db.transaction('rw', db.reports, db.events, async () => {
    if (outcome.kind === 'ok') {
      await db.reports.update(report.id, {
        syncState: 'synced',
        serverVersion: outcome.serverVersion,
        ticketNo: outcome.ticketNo,
        lastError: undefined,
        retryCount: 0,
      });
      await logEvent(
        report.id,
        'synced',
        outcome.duplicate ? 'Server already had this report (the retry was safe)' : 'Server confirmed the report',
      );
      summary.synced++;
      return;
    }

    const attempts = report.retryCount + 1;

    if (outcome.kind === 'permanent') {
      await db.reports.update(report.id, { syncState: 'failed', lastError: outcome.message, retryCount: attempts });
      await logEvent(report.id, 'sync_failed', outcome.message);
      summary.failed++;
    } else if (attempts >= MAX_RETRIES) {
      const message = `Gave up after ${attempts} attempts. Last error: ${outcome.message}`;
      await db.reports.update(report.id, { syncState: 'failed', lastError: message, retryCount: attempts });
      await logEvent(report.id, 'sync_failed', message);
      summary.failed++;
    } else {
      await db.reports.update(report.id, { syncState: 'pending', lastError: outcome.message, retryCount: attempts });
      await logEvent(report.id, 'sync_retry', `Attempt ${attempts} failed: ${outcome.message}`);
      summary.retryLater++;
    }
  });
}

async function doSync(options: SyncOptions): Promise<SyncSummary> {
  const send = options.send ?? sendReport;
  const nowMs = (options.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  const summary: SyncSummary = { synced: 0, retryLater: 0, failed: 0, skipped: 0 };

  // Oldest first, so the server history stays in a sensible order.
  const pending = await db.reports.where('syncState').equals('pending').sortBy('createdAt');

  for (const candidate of pending) {
    if (!options.force && isBackingOff(candidate, nowMs)) {
      summary.skipped++;
      continue;
    }

    const report = await claim(candidate.id, at);
    if (!report) continue;

    let outcome: SendOutcome;
    try {
      outcome = await send(report);
    } catch (e) {
      outcome = { kind: 'retry', message: e instanceof Error ? e.message : 'Unknown error' };
    }

    await applyOutcome(report, outcome, summary);

    // If the connection is down, every other report would time out too. Stop and wait.
    if (outcome.kind === 'retry') break;
  }

  return summary;
}

let inFlight: Promise<SyncSummary> | null = null;

// Only one sync runs at a time. A second call while one is running shares its result.
export function runSync(options: SyncOptions = {}): Promise<SyncSummary> {
  if (!inFlight) {
    inFlight = doSync(options).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// "Sync now" button.
export function syncNow(): Promise<SyncSummary> {
  return runSync({ force: true });
}

// Call once on app start. A report left in 'syncing' means the app closed mid-upload.
// Putting it back in the queue is safe because the server ignores duplicates by id.
export async function recoverInterrupted(): Promise<number> {
  return db.transaction('rw', db.reports, db.events, async () => {
    const stuck = await db.reports.where('syncState').equals('syncing').toArray();
    for (const report of stuck) {
      await db.reports.update(report.id, { syncState: 'pending' });
      await logEvent(report.id, 'sync_recovered', 'The previous upload was interrupted, so it was queued again');
    }
    return stuck.length;
  });
}

// For a report that ended up failed: queue it again with a fresh retry count.
export async function retryFailed(id: string): Promise<boolean> {
  return db.transaction('rw', db.reports, db.events, async () => {
    const report = await db.reports.get(id);
    if (!report || report.syncState !== 'failed') return false;
    await db.reports.update(id, { syncState: 'pending', retryCount: 0, lastError: undefined });
    await logEvent(id, 'sync_retry_requested', 'Queued again by the user');
    return true;
  });
}

// Triggers: app start, the browser's online event, and a 30 second timer.
// Returns a function that stops them (used when the React app unmounts).
export function startSyncEngine(onFinished?: (summary: SyncSummary) => void): () => void {
  const run = (force: boolean) =>
    runSync({ force })
      .then((summary) => onFinished?.(summary))
      .catch((err) => console.error('Sync failed', err));

  recoverInterrupted()
    .then(() => run(false))
    .catch((err) => console.error('Recovery failed', err));

  const onOnline = () => void run(true);
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => void run(false), SYNC_INTERVAL_MS);

  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}