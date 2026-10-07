import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './localDb';
import {
  createDraft,
  deleteDraft,
  getLocalEvents,
  listLocalReports,
  submitReport,
  updateDraft,
  ReportServiceError,
} from './reportService';

const complete = {
  category: 'water_point',
  priority: 'high',
  description: 'Hand pump handle is broken',
  locationText: 'Kebele 04, near the school',
};

beforeEach(async () => {
  await db.reports.clear();
  await db.events.clear();
});

describe('createDraft', () => {
  it('saves a draft on the device with a UUID, Draft status and local sync state', async () => {
    const draft = await createDraft(complete);

    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.workflowStatus).toBe('Draft');
    expect(draft.syncState).toBe('local');

    const stored = await db.reports.get(draft.id);
    expect(stored?.description).toBe('Hand pump handle is broken');
    expect((await getLocalEvents(draft.id)).map((e) => e.type)).toEqual(['created']);
  });

  it('allows a half finished draft', async () => {
    const draft = await createDraft({ description: 'Only a note so far' });
    expect(draft.category).toBe('');
    expect(await db.reports.count()).toBe(1);
  });
});

describe('submitReport', () => {
  it('moves a complete draft to Submitted + pending and logs it', async () => {
    const draft = await createDraft(complete);
    const submitted = await submitReport(draft.id);

    expect(submitted.workflowStatus).toBe('Submitted');
    expect(submitted.syncState).toBe('pending');
    expect((await getLocalEvents(draft.id)).map((e) => e.type)).toContain('submitted');
  });

  it('rejects an incomplete draft with field errors and keeps it as a draft', async () => {
    const draft = await createDraft({ description: 'short' });

    const error = await submitReport(draft.id).catch((e) => e);
    expect(error).toBeInstanceOf(ReportServiceError);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['category', 'priority', 'description', 'locationText']),
    );

    const stored = await db.reports.get(draft.id);
    expect(stored?.workflowStatus).toBe('Draft');
    expect(stored?.syncState).toBe('local');
  });

  it('cannot be submitted twice', async () => {
    const draft = await createDraft(complete);
    await submitReport(draft.id);
    const error = await submitReport(draft.id).catch((e) => e);
    expect(error.code).toBe('ALREADY_SUBMITTED');
  });
});

describe('editing and deleting', () => {
  it('edits a draft but locks it after submission', async () => {
    const draft = await createDraft(complete);
    const edited = await updateDraft(draft.id, { priority: 'critical' });
    expect(edited.priority).toBe('critical');

    await submitReport(draft.id);
    const error = await updateDraft(draft.id, { priority: 'low' }).catch((e) => e);
    expect(error.code).toBe('NOT_EDITABLE');
    expect((await db.reports.get(draft.id))?.priority).toBe('critical');
  });

  it('deletes a draft with its history, but never a submitted report', async () => {
    const draft = await createDraft(complete);
    await deleteDraft(draft.id);
    expect(await db.reports.count()).toBe(0);
    expect(await db.events.count()).toBe(0);

    const kept = await createDraft(complete);
    await submitReport(kept.id);
    const error = await deleteDraft(kept.id).catch((e) => e);
    expect(error.code).toBe('NOT_EDITABLE');
    expect(await db.reports.count()).toBe(1);
  });
});

describe('listLocalReports', () => {
  it('returns the newest report first', async () => {
    const first = await createDraft(complete);
    await new Promise((r) => setTimeout(r, 5));
    const second = await createDraft(complete);

    const list = await listLocalReports();
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});