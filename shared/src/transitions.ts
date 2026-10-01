import type { Status } from './types';

export const TRANSITIONS: Record<Status, readonly Status[]> = {
  Draft: ['Submitted'],
  Submitted: ['Assigned', 'Rejected'],
  Assigned: ['In Progress', 'Rejected'],
  'In Progress': ['Resolved'],
  Resolved: ['In Progress'], // reopen
  Rejected: [],              // terminal
};

export function reasonRequired(from: Status, to: Status): boolean {
  return to === 'Rejected' || from === 'Resolved';
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: 'INVALID_TRANSITION' | 'REASON_REQUIRED'; message: string };

export function checkTransition(from: Status, to: Status, reason?: string): TransitionCheck {
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const list = allowed.length ? allowed.join(', ') : 'none (terminal state)';
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Cannot move from ${from} to ${to}. Allowed: ${list}.`,
    };
  }
  if (reasonRequired(from, to) && !reason?.trim()) {
    return { ok: false, code: 'REASON_REQUIRED', message: `A reason is required to move from ${from} to ${to}.` };
  }
  return { ok: true };
}