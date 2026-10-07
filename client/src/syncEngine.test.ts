import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, type LocalReport } from './localDb';
import { createDraft, submitReport } from './reportService';
import { MAX_RETRIES, backoffMs, recoverInterrupted, retryFailed, runSync } from './syncEngine';
import type { SendOutcome } from './api';

const complete = {
  category: 'water_point',
  priority: 'high',
  description: 'Hand pump handle is broken',
  locationText: 'Kebele 04, near the school',
};

const ok = (duplicate = false): SendOutcome => ({ kind: 'ok', duplicate, serverVersion: 1, ticketNo: 42 });
const retry = (message = 'No connection to the server.'): SendOutcome => ({ kind: 'retry', message });

// A sender that succeeds unless a test says otherwise.
const makeSend = () => vi.fn(async (_report: LocalReport): Promise<SendOutcome> => ok());

async function queued(): Promise<string> {
  const draft = await createDraft(complete);
  await submitReport(draft.id);
  return draft.id;
}

const get = (id: string) => db.reports.get(id) as Promise<LocalReport>;

async function eventTypes(id: string): Promise<string[]> {
  return (await db.events.where('reportId').equals(id).toArray()).map((e) => e.type);
}

beforeEach(async () => {
  await db.reports.clear();
  await db.events.clear();
});

describe('runSync', () => {
  it('uploads a pending report and marks it synced with the server details', async () => {
    const id = await queued();
    const send = makeSend();

    const summary = await runSync({ send });

    expect(summary.synced).toBe(1);
    const report = await get(id);
    expect(report.syncState).toBe('synced');
    expect(report.serverVersion).toBe(1);
    expect(report.ticketNo).toBe(42);
    expect(await eventTypes(id)).toContain('synced');
  });

  it('treats a "server already has it" answer as success', async () => {
    const id = await queued();
    const send = makeSend();
    send.mockResolvedValueOnce(ok(true));

    await runSync({ send });

    expect((await get(id)).syncState).toBe('synced');
  });

  it('keeps the report after a temporary failure and succeeds on the next try with the same id', async () => {
    const id = await queued();
    const send = makeSend();
    send.mockResolvedValueOnce(retry());

    const first = await runSync({ send });
    expect(first).toMatchObject({ synced: 0, retryLater: 1 });
    let report = await get(id);
    expect(report.syncState).toBe('pending');
    expect(report.retryCount).toBe(1);
    expect(report.lastError).toContain('No connection');
    expect(report.description).toBe('Hand pump handle is broken');

    await runSync({ send, force: true });
    report = await get(id);
    expect(report.syncState).toBe('synced');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[0].id)).toEqual([id, id]);
  });

  it('waits for the backoff time before retrying, unless forced', async () => {
    await queued();
    const send = makeSend();
    send.mockResolvedValue(retry());
    const t0 = Date.now();

    await runSync({ send, now: () => t0 });
    expect(send).toHaveBeenCalledTimes(1);

    const early = await runSync({ send, now: () => t0 + backoffMs(1) - 1 });
    expect(early.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    await runSync({ send, now: () => t0 + backoffMs(1) });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum retries, then lets the user queue it again', async () => {
    const id = await queued();
    const send = makeSend();
    send.mockResolvedValue(retry('Timeout'));

    for (let i = 0; i < MAX_RETRIES; i++) await runSync({ send, force: true });

    const failed = await get(id);
    expect(failed.syncState).toBe('failed');
    expect(failed.lastError).toContain('Gave up');
    expect(send).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(await eventTypes(id)).toContain('sync_failed');

    // Failed reports are not retried automatically.
    await runSync({ send, force: true });
    expect(send).toHaveBeenCalledTimes(MAX_RETRIES);

    expect(await retryFailed(id)).toBe(true);
    const again = await get(id);
    expect(again.syncState).toBe('pending');
    expect(again.retryCount).toBe(0);
  });

  it('marks a permanent rejection as failed straight away, with the reason, and does not retry it', async () => {
    const id = await queued();
    const send = makeSend();
    send.mockResolvedValueOnce({ kind: 'permanent', message: 'Description is too short.' });

    const summary = await runSync({ send });

    expect(summary.failed).toBe(1);
    const report = await get(id);
    expect(report.syncState).toBe('failed');
    expect(report.lastError).toBe('Description is too short.');
    expect(await eventTypes(id)).toContain('sync_failed');

    await runSync({ send, force: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops after the first temporary failure so a dead connection is not tried repeatedly', async () => {
    const a = await queued();
    await new Promise((r) => setTimeout(r, 5));
    const b = await queued();
    const send = makeSend();
    send.mockResolvedValue(retry());

    await runSync({ send });

    expect(send).toHaveBeenCalledTimes(1);
    expect((await get(a)).syncState).toBe('pending');
    expect((await get(b)).syncState).toBe('pending');
    expect((await get(b)).retryCount).toBe(0);
  });

  it('sends the oldest report first', async () => {
    const first = await queued();
    await new Promise((r) => setTimeout(r, 5));
    const second = await queued();
    const send = makeSend();

    await runSync({ send });

    expect(send.mock.calls.map((call) => call[0].id)).toEqual([first, second]);
  });

  it('never uploads drafts', async () => {
    const draft = await createDraft(complete);
    const send = makeSend();

    await runSync({ send, force: true });

    expect(send).not.toHaveBeenCalled();
    expect((await get(draft.id)).syncState).toBe('local');
  });

  it('treats a sender that throws as a temporary failure and keeps the data', async () => {
    const id = await queued();
    const send = vi.fn(async (_report: LocalReport): Promise<SendOutcome> => {
      throw new Error('boom');
    });

    await runSync({ send });

    const report = await get(id);
    expect(report.syncState).toBe('pending');
    expect(report.lastError).toContain('boom');
  });

  it('shares one run when called twice at once, so a report is sent only once', async () => {
    await queued();
    const send = vi.fn(async (_report: LocalReport): Promise<SendOutcome> => {
      await new Promise((r) => setTimeout(r, 20));
      return ok();
    });

    const [a, b] = await Promise.all([runSync({ send }), runSync({ send })]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe('recoverInterrupted', () => {
  it('puts a report stuck in syncing back in the queue, and it then uploads', async () => {
    const id = await queued();
    // Simulates the app being closed in the middle of an upload.
    await db.reports.update(id, { syncState: 'syncing' });
    const send = makeSend();

    await runSync({ send });
    expect(send).not.toHaveBeenCalled(); // a stuck report is not picked up by itself

    expect(await recoverInterrupted()).toBe(1);
    expect((await get(id)).syncState).toBe('pending');
    expect(await eventTypes(id)).toContain('sync_recovered');

    await runSync({ send });
    expect((await get(id)).syncState).toBe('synced');
  });
});