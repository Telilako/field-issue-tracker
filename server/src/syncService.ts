import { Prisma, type Report } from '@prisma/client';
import { validateReportInput, type FieldError, type ReportInput } from '@fit/shared';
import { prisma } from './db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SyncResult =
  | { kind: 'created'; report: Report }
  | { kind: 'duplicate'; report: Report }
  | { kind: 'conflict'; report: Report }
  | { kind: 'invalid'; errors: FieldError[] };

function sameContent(r: Report, i: ReportInput): boolean {
  return (
    r.category === i.category &&
    r.description === i.description &&
    r.priority === i.priority &&
    r.latitude === (i.latitude ?? null) &&
    r.longitude === (i.longitude ?? null) &&
    r.locationText === (i.locationText ?? null) &&
    r.reportedAt.getTime() === new Date(i.reportedAt).getTime()
  );
}

function classify(existing: Report, input: ReportInput): SyncResult {
  return sameContent(existing, input)
    ? { kind: 'duplicate', report: existing }
    : { kind: 'conflict', report: existing };
}

export async function syncReport(body: unknown, actor: string): Promise<SyncResult> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const id = raw.id;
  const validation = validateReportInput(raw);

  if (!validation.ok || typeof id !== 'string' || !UUID_RE.test(id)) {
    const errors: FieldError[] = validation.ok ? [] : [...validation.errors];
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      errors.unshift({ field: 'id', message: 'id must be a valid UUID.' });
    }
    return { kind: 'invalid', errors };
  }

  const input = validation.value;

  const existing = await prisma.report.findUnique({ where: { id } });
  if (existing) return classify(existing, input);

  try {
    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          id,
          category: input.category,
          description: input.description,
          priority: input.priority,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          locationText: input.locationText ?? null,
          status: 'Submitted',
          reportedBy: actor,
          reportedAt: new Date(input.reportedAt),
        },
      });
      await tx.reportEvent.create({
        data: { reportId: id, type: 'created', actor, toStatus: 'Submitted', occurredAt: new Date(input.reportedAt) },
      });
      await tx.reportEvent.create({
        data: { reportId: id, type: 'synced', actor, toStatus: 'Submitted', occurredAt: new Date() },
      });
      return created;
    });
    return { kind: 'created', report };
  } catch (e) {
    // Two identical retries arrived together and the other one won the insert.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await prisma.report.findUnique({ where: { id } });
      if (winner) return classify(winner, input);
    }
    throw e;
  }
}