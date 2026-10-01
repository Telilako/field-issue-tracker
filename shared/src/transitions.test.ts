import { describe, it, expect } from 'vitest';
import { checkTransition, TRANSITIONS } from './transitions';
import { STATUSES } from './types';

describe('status workflow', () => {
  it('allows the happy path', () => {
    expect(checkTransition('Draft', 'Submitted').ok).toBe(true);
    expect(checkTransition('Submitted', 'Assigned').ok).toBe(true);
    expect(checkTransition('Assigned', 'In Progress').ok).toBe(true);
    expect(checkTransition('In Progress', 'Resolved').ok).toBe(true);
  });

  it('rejects skipping steps, with a helpful message', () => {
    const r = checkTransition('Submitted', 'Resolved');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID_TRANSITION');
      expect(r.message).toContain('Assigned');
    }
  });

  it('treats Rejected as terminal', () => {
    for (const to of STATUSES) expect(checkTransition('Rejected', to).ok).toBe(false);
  });

  it('requires a reason to reject or reopen', () => {
    const rej = checkTransition('Submitted', 'Rejected');
    expect(rej.ok === false && rej.code).toBe('REASON_REQUIRED');
    expect(checkTransition('Submitted', 'Rejected', 'Duplicate report').ok).toBe(true);
    expect(checkTransition('Resolved', 'In Progress', '  ').ok).toBe(false);
    expect(checkTransition('Resolved', 'In Progress', 'Leak returned').ok).toBe(true);
  });

  it('never allows a status to transition to itself', () => {
    for (const s of STATUSES) expect(TRANSITIONS[s]).not.toContain(s);
  });
});