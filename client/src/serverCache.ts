import { STATUSES, type Status } from '@fit/shared';
import { db } from './localDb';
import { fetchServerReports, type ServerReport } from './api';

export interface ServerListResult {
  reports: ServerReport[];
  fromCache: boolean;
  cachedAt?: string;
}

// Coordinator list: try the server, remember the answer, and fall back to the last copy offline.
export async function loadServerReports(): Promise<ServerListResult> {
  try {
    const reports = await fetchServerReports();
    const cachedAt = new Date().toISOString();
    await db.transaction('rw', db.serverReports, async () => {
      await db.serverReports.clear();
      await db.serverReports.bulkAdd(reports.map((r) => ({ id: r.id, data: r, cachedAt })));
    });
    return { reports, fromCache: false, cachedAt };
  } catch {
    const rows = await db.serverReports.toArray();
    const reports = rows
      .map((row) => row.data as ServerReport)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { reports, fromCache: true, cachedAt: rows[0]?.cachedAt };
  }
}

const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value);

// A field worker's device only knows "Submitted". When a coordinator moves the report on,
// copy the server's status onto the synced local copy. Pending reports are never touched.
export async function refreshLocalStatuses(): Promise<number> {
  let serverReports: ServerReport[];
  try {
    serverReports = await fetchServerReports();
  } catch {
    return 0; // offline: keep what we have
  }

  const byId = new Map(serverReports.map((r) => [r.id, r]));
  const synced = await db.reports.where('syncState').equals('synced').toArray();
  let changed = 0;

  for (const local of synced) {
    const remote = byId.get(local.id);
    if (!remote || !isStatus(remote.status)) continue;
    if (remote.status === local.workflowStatus && remote.version === local.serverVersion) continue;

    const newStatus = remote.status;
    await db.transaction('rw', db.reports, db.events, async () => {
      await db.reports.update(local.id, { workflowStatus: newStatus, serverVersion: remote.version });
      if (newStatus !== local.workflowStatus) {
        await db.events.add({
          reportId: local.id,
          type: 'status_updated',
          at: new Date().toISOString(),
          details: `${local.workflowStatus} → ${newStatus}`,
        });
      }
    });
    changed++;
  }
  return changed;
}