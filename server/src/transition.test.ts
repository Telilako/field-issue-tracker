import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { prisma } from './db';

const app = createApp();
const ID = '7c1e2f3a-4b5c-4d6e-9f70-8192a3b4c5d6';

const payload = {
  id: ID,
  category: 'equipment',
  priority: 'medium',
  description: 'Generator will not start',
  locationText: 'Health post, Kebele 02',
  reportedAt: '2026-10-01T08:00:00Z',
};

const coordinator = { 'x-role': 'coordinator', 'x-user': 'daniel' };

async function cleanup() {
  await prisma.reportEvent.deleteMany({ where: { reportId: ID } });
  await prisma.report.deleteMany({ where: { id: ID } });
}

function move(to: string, expectedVersion: number, reason?: string, headers: Record<string, string> = coordinator) {
  return request(app)
    .post(`/api/reports/${ID}/transition`)
    .set(headers)
    .send({ to, expectedVersion, reason });
}

beforeEach(async () => {
  await cleanup();
  await request(app).post('/api/sync/reports').send(payload); // starts as Submitted, version 1
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/reports/:id/transition', () => {
  it('moves a report forward, bumps the version and writes a history event', async () => {
    const res = await move('Assigned', 1);

    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe('Assigned');
    expect(res.body.report.version).toBe(2);

    const events = await prisma.reportEvent.findMany({ where: { reportId: ID, type: 'status_changed' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.fromStatus).toBe('Submitted');
    expect(events[0]?.toStatus).toBe('Assigned');
  });

  it('rejects an invalid jump with 409, keeps the status and logs the attempt', async () => {
    const res = await move('Resolved', 1);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(res.body.error.message).toContain('Assigned');

    const report = await prisma.report.findUniqueOrThrow({ where: { id: ID } });
    expect(report.status).toBe('Submitted');
    expect(report.version).toBe(1);
    expect(await prisma.reportEvent.count({ where: { reportId: ID, type: 'transition_rejected' } })).toBe(1);
  });

  it('requires a reason to reject a report', async () => {
    const res = await move('Rejected', 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REASON_REQUIRED');

    const ok = await move('Rejected', 1, 'Duplicate of an earlier report');
    expect(ok.status).toBe(200);
    expect(ok.body.report.status).toBe('Rejected');
  });

  it('returns 409 VERSION_CONFLICT when the coordinator used stale data', async () => {
    await move('Assigned', 1);
    const stale = await move('Rejected', 1, 'Too late');

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.report.status).toBe('Assigned');
  });

  it('lets only one of two simultaneous moves win', async () => {
    const [a, b] = await Promise.all([move('Assigned', 1), move('Rejected', 1, 'Not our area')]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: ID } });
    expect(report.version).toBe(2);
    expect(await prisma.reportEvent.count({ where: { reportId: ID, type: 'status_changed' } })).toBe(1);
  });

  it('forbids a field worker from changing status', async () => {
    const res = await move('Assigned', 1, undefined, { 'x-role': 'field-worker', 'x-user': 'amara' });
    expect(res.status).toBe(403);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: ID } });
    expect(report.status).toBe('Submitted');
  });

  it('allows reopening a resolved report with a reason', async () => {
    await move('Assigned', 1);
    await move('In Progress', 2);
    await move('Resolved', 3);

    const noReason = await move('In Progress', 4);
    expect(noReason.status).toBe(409);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const reopened = await move('In Progress', 4, 'The leak returned');
    expect(reopened.status).toBe(200);
    expect(reopened.body.report.status).toBe('In Progress');
  });

  it('returns 400 for an unknown status and 404 for an unknown report', async () => {
    expect((await move('Flying', 1)).status).toBe(400);

    const missing = await request(app)
      .post('/api/reports/00000000-0000-4000-8000-000000000000/transition')
      .set(coordinator)
      .send({ to: 'Assigned', expectedVersion: 1 });
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/reports', () => {
  it('lists reports, filters by status, and returns details with history', async () => {
    const list = await request(app).get('/api/reports?status=Submitted');
    expect(list.status).toBe(200);
    expect(list.body.reports.some((r: { id: string }) => r.id === ID)).toBe(true);

    const none = await request(app).get('/api/reports?status=Resolved');
    expect(none.body.reports.some((r: { id: string }) => r.id === ID)).toBe(false);

    const detail = await request(app).get(`/api/reports/${ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.report.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['created', 'synced']),
    );

    const missing = await request(app).get('/api/reports/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });
});