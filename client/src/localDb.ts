import Dexie, { type EntityTable } from 'dexie';
import type { Status } from '@fit/shared';

// local   = a draft, never sent to the server
// pending = submitted, waiting to be uploaded
// syncing = upload in progress
// synced  = server confirmed
// failed  = server rejected it, or retries ran out
export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'failed';

export interface LocalReport {
  id: string; // UUID made on the device, also the server's primary key
  // Drafts may be half finished, so these are plain strings.
  // They are validated with the shared rules when the report is submitted.
  category: string;
  description: string;
  priority: string;
  latitude?: number;
  longitude?: number;
  locationText?: string;
  reportedAt: string; // when the worker first noticed the problem (device time)
  workflowStatus: Status; // Draft, Submitted, Assigned...
  syncState: SyncState; // separate from workflowStatus
  serverVersion?: number;
  ticketNo?: number;
  lastError?: string;
  retryCount: number;
  lastAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalEvent {
  id?: number; // auto-increment
  reportId: string;
  type: string; // created, edited, submitted, synced, sync_failed
  at: string; // device time
  details?: string;
}

export const db = new Dexie('field-issue-tracker') as Dexie & {
  reports: EntityTable<LocalReport, 'id'>;
  events: EntityTable<LocalEvent, 'id'>;
};

db.version(1).stores({
  reports: 'id, workflowStatus, syncState, createdAt',
  events: '++id, reportId, at',
});