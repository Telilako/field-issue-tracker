import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalReport } from '../localDb';
import { listLocalReports } from '../reportService';

export interface SyncCounts {
  pending: number;
  syncing: number;
  failed: number;
}

// useLiveQuery re-runs whenever the local database changes,
// so the screen updates by itself when the sync engine marks a report synced.
export function useLocalReports(): LocalReport[] {
  return useLiveQuery(() => listLocalReports(), [], [] as LocalReport[]);
}

export function useSyncCounts(): SyncCounts {
  return useLiveQuery(
    async () => ({
      pending: await db.reports.where('syncState').equals('pending').count(),
      syncing: await db.reports.where('syncState').equals('syncing').count(),
      failed: await db.reports.where('syncState').equals('failed').count(),
    }),
    [],
    { pending: 0, syncing: 0, failed: 0 },
  );
}