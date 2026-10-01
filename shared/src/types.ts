export const CATEGORIES = [
  'water_point', 'equipment', 'service_interruption',
  'safety', 'maintenance', 'other',
] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const STATUSES = [
  'Draft', 'Submitted', 'Assigned', 'In Progress', 'Resolved', 'Rejected',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];

export interface ReportInput {
  category: Category;
  description: string;
  priority: Priority;
  latitude?: number;
  longitude?: number;
  locationText?: string;
  reportedAt: string; // ISO 8601, device time
}

export interface FieldError {
  field: string;
  message: string;
}