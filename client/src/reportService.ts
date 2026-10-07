import { validateReportInput, type FieldError } from '@fit/shared';
import { db, type LocalEvent, type LocalReport } from './localDb';

export class ReportServiceError extends Error {
  code: string;
  errors?: FieldError[];

  constructor(code: string, message: string, errors?: FieldError[]) {
    super(message);
    this.code = code;
    this.errors = errors;
  }
}

export interface DraftFields {
  category: string;
  description: string;
  priority: string;
  latitude?: number;
  longitude?: number;
  locationText?: string;
}

const now = () => new Date().toISOString();

function logEvent(reportId: string, type: string, details?: string): Promise<unknown> {
  return db.events.add({ reportId, type, at: now(), details });
}

async function requireReport(id: string): Promise<LocalReport> {
  const report = await db.reports.get(id);
  if (!report) throw new ReportServiceError('NOT_FOUND', 'Report not found on this device.');
  return report;
}

export async function createDraft(fields: Partial<DraftFields> = {}): Promise<LocalReport> {
  const time = now();
  const report: LocalReport = {
    id: crypto.randomUUID(),
    category: fields.category ?? '',
    description: fields.description ?? '',
    priority: fields.priority ?? '',
    latitude: fields.latitude,
    longitude: fields.longitude,
    locationText: fields.locationText,
    reportedAt: time,
    workflowStatus: 'Draft',
    syncState: 'local',
    retryCount: 0,
    createdAt: time,
    updatedAt: time,
  };
  await db.transaction('rw', db.reports, db.events, async () => {
    await db.reports.add(report);
    await logEvent(report.id, 'created', 'Draft saved on device');
  });
  return report;
}

export async function updateDraft(id: string, fields: Partial<DraftFields>): Promise<LocalReport> {
  return db.transaction('rw', db.reports, db.events, async () => {
    const report = await requireReport(id);
    if (report.workflowStatus !== 'Draft') {
      throw new ReportServiceError('NOT_EDITABLE', 'Only drafts can be edited. Submitted reports are locked.');
    }
    await db.reports.update(id, { ...fields, updatedAt: now() });
    await logEvent(id, 'edited');
    return requireReport(id);
  });
}

export async function submitReport(id: string): Promise<LocalReport> {
  return db.transaction('rw', db.reports, db.events, async () => {
    const report = await requireReport(id);
    if (report.workflowStatus !== 'Draft') {
      throw new ReportServiceError('ALREADY_SUBMITTED', 'This report was already submitted.');
    }

    // Validate BEFORE queuing, so we never queue something the server will certainly reject.
    const result = validateReportInput({
      category: report.category,
      priority: report.priority,
      description: report.description,
      latitude: report.latitude,
      longitude: report.longitude,
      locationText: report.locationText,
      reportedAt: report.reportedAt,
    });
    if (!result.ok) {
      throw new ReportServiceError('VALIDATION_FAILED', 'Please fix the highlighted fields.', result.errors);
    }

    await db.reports.update(id, {
      ...result.value, // trimmed, normalised values
      workflowStatus: 'Submitted',
      syncState: 'pending',
      retryCount: 0,
      lastError: undefined,
      updatedAt: now(),
    });
    await logEvent(id, 'submitted', 'Queued for upload');
    return requireReport(id);
  });
}

export async function deleteDraft(id: string): Promise<void> {
  await db.transaction('rw', db.reports, db.events, async () => {
    const report = await requireReport(id);
    if (report.workflowStatus !== 'Draft') {
      throw new ReportServiceError('NOT_EDITABLE', 'Only drafts can be deleted.');
    }
    await db.reports.delete(id);
    await db.events.where('reportId').equals(id).delete();
  });
}

export function listLocalReports(): Promise<LocalReport[]> {
  return db.reports.orderBy('createdAt').reverse().toArray();
}

export function getLocalReport(id: string): Promise<LocalReport | undefined> {
  return db.reports.get(id);
}

export function getLocalEvents(reportId: string): Promise<LocalEvent[]> {
  return db.events.where('reportId').equals(reportId).sortBy('at');
}