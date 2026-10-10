import { describe, it, expect } from 'vitest';
import { interpretResponse } from './api';

describe('interpretResponse', () => {
  it('treats 201 as a new report confirmed by the server', () => {
    const r = interpretResponse(201, { report: { version: 1, ticketNo: 7 } });
    expect(r).toEqual({ kind: 'ok', duplicate: false, serverVersion: 1, ticketNo: 7 });
  });

  it('treats 200 as success for a report the server already had', () => {
    const r = interpretResponse(200, { report: { version: 1, ticketNo: 7 } });
    expect(r).toMatchObject({ kind: 'ok', duplicate: true });
  });

  it('treats server errors, rate limits and timeouts as temporary', () => {
    for (const status of [500, 502, 503, 408, 429]) {
      expect(interpretResponse(status, null).kind).toBe('retry');
    }
  });

  it('treats validation errors and id conflicts as permanent, with the field messages', () => {
    const bad = interpretResponse(400, {
      error: { message: 'The report has invalid fields.', fields: [{ field: 'category', message: 'Choose a valid category.' }] },
    });
    expect(bad.kind).toBe('permanent');
    if (bad.kind === 'permanent') expect(bad.message).toContain('category: Choose a valid category.');

    expect(interpretResponse(409, { error: { message: 'Conflict' } }).kind).toBe('permanent');
  });

  it('never treats a success status without a report body as confirmed', () => {
    expect(interpretResponse(200, null).kind).toBe('retry');
  });
});