import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { prisma } from './db';

const app = createApp();

const payload = {
  id: '5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  category: 'water_point',
  priority: 'high',
  description: 'Hand pump handle is broken',
  locationText: 'Kebele 04, near the school',
  reportedAt: '2026-10-01T08:00:00Z',
};

// Removes only the record these tests create. Other data is never touched.
async function cleanup() {
  await prisma.reportEvent.deleteMany({ where: { reportId: payload.id } });
  await prisma.report.deleteMany({ where: { id: payload.id } });
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/sync/reports', () => {
  it('creates a new report as Submitted and writes created + synced events', async () => {
    const res = await request(app).post('/api/sync/reports').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('created');
    expect(res.body.report.status).toBe('Submitted');

    const events = await prisma.reportEvent.findMany({ where: { reportId: payload.id } });
    expect(events.map((e) => e.type).sort()).toEqual(['created', 'synced']);
  });

  it('is idempotent: sending the same report twice creates only one record', async () => {
    const first = await request(app).post('/api/sync/reports').send(payload);
    const second = await request(app).post('/api/sync/reports').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate');
    expect(await prisma.report.count({ where: { id: payload.id } })).toBe(1);
    expect(await prisma.reportEvent.count({ where: { reportId: payload.id } })).toBe(2);
  });

  it('survives two simultaneous retries without creating duplicates', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/sync/reports').send(payload),
      request(app).post('/api/sync/reports').send(payload),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prisma.report.count({ where: { id: payload.id } })).toBe(1);
  });

  it('rejects invalid input with field-level errors and saves nothing', async () => {
    const res = await request(app)
      .post('/api/sync/reports')
      .send({ ...payload, category: 'nope', description: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const fields = res.body.error.fields.map((f: { field: string }) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['category', 'description']));
    expect(await prisma.report.count({ where: { id: payload.id } })).toBe(0);
  });

  it('rejects a missing or malformed id', async () => {
    const res = await request(app)
      .post('/api/sync/reports')
      .send({ ...payload, id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields[0].field).toBe('id');
  });

  it('returns 409 when the same id arrives with different content', async () => {
    await request(app).post('/api/sync/reports').send(payload);
    const res = await request(app)
      .post('/api/sync/reports')
      .send({ ...payload, description: 'A completely different problem' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ID_CONFLICT');
    expect(await prisma.report.count({ where: { id: payload.id } })).toBe(1);
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/sync/reports')
      .set('Content-Type', 'application/json')
      .send('{ broken');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_JSON');
  });
});