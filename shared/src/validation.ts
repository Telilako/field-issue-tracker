import { CATEGORIES, PRIORITIES, type FieldError, type ReportInput } from './types';

export type ValidationResult =
  | { ok: true; value: ReportInput }
  | { ok: false; errors: FieldError[] };

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function validateReportInput(input: unknown, now: Date = new Date()): ValidationResult {
  const errors: FieldError[] = [];
  const i = (input ?? {}) as Record<string, unknown>;
  const err = (field: string, message: string) => errors.push({ field, message });

  if (!CATEGORIES.includes(i.category as never)) err('category', 'Choose a valid category.');
  if (!PRIORITIES.includes(i.priority as never)) err('priority', 'Choose a valid priority.');

  const description = typeof i.description === 'string' ? i.description.trim() : '';
  if (description.length < 10) err('description', 'Describe the problem in at least 10 characters.');
  if (description.length > 1000) err('description', 'Description must be 1000 characters or fewer.');

  const hasLat = i.latitude !== undefined && i.latitude !== null;
  const hasLng = i.longitude !== undefined && i.longitude !== null;
  if (hasLat !== hasLng) err('latitude', 'Provide both latitude and longitude, or neither.');
  if (hasLat && hasLng) {
    if (typeof i.latitude !== 'number' || i.latitude < -90 || i.latitude > 90) err('latitude', 'Latitude must be between -90 and 90.');
    if (typeof i.longitude !== 'number' || i.longitude < -180 || i.longitude > 180) err('longitude', 'Longitude must be between -180 and 180.');
  }
  const locationText = typeof i.locationText === 'string' ? i.locationText.trim() : '';
  if (!hasLat && !locationText) err('locationText', 'Provide GPS coordinates or describe the location.');

  const reportedAt = typeof i.reportedAt === 'string' ? Date.parse(i.reportedAt) : NaN;
  if (Number.isNaN(reportedAt)) err('reportedAt', 'Report time is not a valid date.');
  else if (reportedAt > now.getTime() + MAX_CLOCK_SKEW_MS) err('reportedAt', 'Report time cannot be in the future.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      category: i.category as ReportInput['category'],
      priority: i.priority as ReportInput['priority'],
      description,
      ...(hasLat ? { latitude: i.latitude as number, longitude: i.longitude as number } : {}),
      ...(locationText ? { locationText } : {}),
      reportedAt: i.reportedAt as string,
    },
  };
}