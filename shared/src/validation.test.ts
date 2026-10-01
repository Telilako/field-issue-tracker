import { describe, it, expect } from 'vitest';
import { validateReportInput } from './validation';

const now = new Date('2026-09-30T10:00:00Z');
const valid = {
  category: 'water_point', priority: 'high',
  description: 'Hand pump handle is broken',
  locationText: 'Kebele 04, near the school',
  reportedAt: '2026-09-30T09:55:00Z',
};

describe('validateReportInput', () => {
  it('accepts a valid report and trims the description', () => {
    const r = validateReportInput({ ...valid, description: '  Hand pump handle is broken  ' }, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('Hand pump handle is broken');
  });

  it('rejects unknown category, short description and missing location', () => {
    const r = validateReportInput({ ...valid, category: 'x', description: 'short', locationText: '' }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['category', 'description', 'locationText']));
  });

  it('accepts GPS instead of location text, but rejects out-of-range or half coordinates', () => {
    const gps = { ...valid, locationText: undefined, latitude: 9.03, longitude: 38.74 };
    expect(validateReportInput(gps, now).ok).toBe(true);
    expect(validateReportInput({ ...gps, latitude: 95 }, now).ok).toBe(false);
    expect(validateReportInput({ ...gps, longitude: undefined }, now).ok).toBe(false);
  });

  it('rejects report times in the future but tolerates small clock skew', () => {
    expect(validateReportInput({ ...valid, reportedAt: '2026-09-30T11:00:00Z' }, now).ok).toBe(false);
    expect(validateReportInput({ ...valid, reportedAt: '2026-09-30T10:03:00Z' }, now).ok).toBe(true);
  });

  it('does not crash on garbage input', () => {
    expect(validateReportInput(null, now).ok).toBe(false);
    expect(validateReportInput('nope', now).ok).toBe(false);
  });
});