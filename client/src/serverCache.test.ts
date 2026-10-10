import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from './localDb';
import { createDraft, submitReport } from './reportService';
import { fetchServerReports } from './api';
import type { ServerReport } from './api';
import { loadServerReports, refreshLocalStatuses } from './serverCache';

vi.mock('./api', () => ({ fetchServerReports: vi.fn() }));
const mockFetch = vi.mocked(fetchServerReports);

const complete = {
  category: 'water_point',
  priority: 'high',
  description: 'Hand pump handle is broken',
  locationText: 'Kebele 04, near the school',
};

async function submitted(): Promise<string> {
  const draft = await createDraft(complete);
  await submitReport(draft.id);
  return draft.id;
}

const serverCopy = (id: string, status: string, version: number) =>
  ({ id, status, version, createdAt: '2026-10-01T08:00:00Z' }) as ServerReport;

beforeEach(async () => {
  await db.reports.clear();
  await db.events.clear();
  await db.serverReports.clear();
  mockFetch.mockReset();
});

describe('refreshLocalStatuses', () => {
  it('copies a newer server status onto a synced report and logs it', async () => {
    const id = await submitted();
    await db.reports.update(id, { syncState: 'synced', serverVersion: 1 });
    mockFetch.mockResolvedValue([serverCopy(id, 'Assigned', 2)]);

    expect(await refreshLocalStatuses()).toBe(1);

    const report = await db.reports.get(id);
    expect(report?.workflowStatus).toBe('Assigned');
    expect(report?.serverVersion).toBe(2);
    const types = (await db.events.where('reportId').equals(id).toArray()).map((e) => e.type);
    expect(types).toContain('status_updated');
  });

  it('never touches a report that has not synced yet', async () => {
    const id = await submitted(); // still pending
    mockFetch.mockResolvedValue([serverCopy(id, 'Assigned', 2)]);

    expect(await refreshLocalStatuses()).toBe(0);
    expect((await db.reports.get(id))?.workflowStatus).toBe('Submitted');
  });

  it('keeps local data and returns 0 when the server cannot be reached', async () => {
    const id = await submitted();
    await db.reports.update(id, { syncState: 'synced', serverVersion: 1 });
    mockFetch.mockRejectedValue(new Error('offline'));

    expect(await refreshLocalStatuses()).toBe(0);
    expect((await db.reports.get(id))?.workflowStatus).toBe('Submitted');
  });
});

describe('loadServerReports', () => {
  it('returns the last saved list when the server is unreachable', async () => {
    mockFetch.mockResolvedValueOnce([serverCopy('a', 'Submitted', 1), serverCopy('b', 'Assigned', 2)]);
    const online = await loadServerReports();
    expect(online.fromCache).toBe(false);
    expect(online.reports).toHaveLength(2);

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const offline = await loadServerReports();
    expect(offline.fromCache).toBe(true);
    expect(offline.reports.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});