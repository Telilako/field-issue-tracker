import type { LocalReport } from './localDb';

// What the sync engine needs to know about one upload attempt.
export type SendOutcome =
  | { kind: 'ok'; duplicate: boolean; serverVersion?: number; ticketNo?: number }
  | { kind: 'retry'; message: string } // temporary: try again later
  | { kind: 'permanent'; message: string }; // the server said no, retrying will not help

interface ApiBody {
  report?: { version?: number; ticketNo?: number };
  error?: { message?: string; fields?: { field: string; message: string }[] };
}

// Requests go through the Vite dev proxy, so the path is relative.
const API_BASE = '';
const SEND_TIMEOUT_MS = 10_000;
const IDENTITY_KEY = 'fit.identity';

export interface Identity {
  role: 'field-worker' | 'coordinator';
  user: string;
}

// Roles are simulated, as the brief allows. The role switcher will call setIdentity.
export function getIdentity(): Identity {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.role === 'coordinator' || parsed?.role === 'field-worker') {
        return { role: parsed.role, user: String(parsed.user ?? parsed.role) };
      }
    }
  } catch {
    // storage unavailable or corrupted: fall back to the default
  }
  return { role: 'field-worker', user: 'amara' };
}

export function setIdentity(identity: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // ignore: the default identity is used
  }
}

function authHeaders(): Record<string, string> {
  const { role, user } = getIdentity();
  return { 'Content-Type': 'application/json', 'x-role': role, 'x-user': user };
}

function describeError(data: ApiBody | null, status: number): string {
  const base = data?.error?.message ?? `The server rejected the report (${status}).`;
  const fields = (data?.error?.fields ?? []).map((f) => `${f.field}: ${f.message}`).join(' ');
  return fields ? `${base} ${fields}` : base;
}

// Pure function, so the temporary/permanent decision is easy to test.
export function interpretResponse(status: number, data: ApiBody | null): SendOutcome {
  if (status === 200 || status === 201) {
    if (!data?.report) return { kind: 'retry', message: 'Unexpected response from the server.' };
    return {
      kind: 'ok',
      duplicate: status === 200,
      serverVersion: data.report.version,
      ticketNo: data.report.ticketNo,
    };
  }
  if (status >= 500 || status === 408 || status === 429) {
    return { kind: 'retry', message: `Server is busy or unavailable (${status}).` };
  }
  return { kind: 'permanent', message: describeError(data, status) };
}

export async function sendReport(report: LocalReport): Promise<SendOutcome> {
  const body = {
    id: report.id,
    category: report.category,
    priority: report.priority,
    description: report.description,
    latitude: report.latitude,
    longitude: report.longitude,
    locationText: report.locationText,
    reportedAt: report.reportedAt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/sync/reports`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as ApiBody | null;
    return interpretResponse(res.status, data);
  } catch {
    // Network down, DNS failure, or timeout: the server may or may not have the report.
    // The report id makes a later retry safe either way.
    return { kind: 'retry', message: 'No connection to the server.' };
  } finally {
    clearTimeout(timer);
  }
}

// navigator.onLine only says the device has a network, not that the server is reachable.
export async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}