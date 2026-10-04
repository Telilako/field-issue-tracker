import { Prisma, type Report, type ReportEvent } from '@prisma/client';
import { checkTransition, STATUSES, type Status } from '@fit/shared';
import { prisma } from './db';

export type TransitionResult =
  | { kind: 'ok'; report: Report }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'bad_request'; code: string; message: string }
  | { kind: 'rejected'; code: string; message: string; report: Report }
  | { kind: 'version_conflict'; report: Report };

export interface TransitionInput {
  to: unknown;
  expectedVersion: unknown;
  reason?: unknown;
}

export async function listReports(filter: { status?: string; priority?: string }): Promise<Report[]> {
  return prisma.report.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getReport(id: string): Promise<(Report & { events: ReportEvent[] }) | null> {
  return prisma.report.findUnique({
    where: { id },
    include: { events: { orderBy: { recordedAt: 'asc' } } },
  });
}

export async function transitionReport(
  id: string,
  input: TransitionInput,
  actor: string,
  role: string,
): Promise<TransitionResult> {
  if (role !== 'coordinator') return { kind: 'forbidden' };

  if (typeof input.to !== 'string' || !STATUSES.includes(input.to as Status)) {
    return { kind: 'bad_request', code: 'INVALID_STATUS', message: 'to must be a valid status.' };
  }
  if (!Number.isInteger(input.expectedVersion)) {
    return { kind: 'bad_request', code: 'VERSION_REQUIRED', message: 'expectedVersion must be an integer.' };
  }
  const to = input.to as Status;
  const expectedVersion = input.expectedVersion as number;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) return { kind: 'not_found' };

  // Stale data: someone else changed this report since the coordinator loaded it.
  if (report.version !== expectedVersion) return { kind: 'version_conflict', report };

  const check = checkTransition(report.status as Status, to, reason);
  if (!check.ok) {
    // Failed attempts are part of the history too.
    await prisma.reportEvent.create({
      data: {
        reportId: id,
        type: 'transition_rejected',
        actor,
        fromStatus: report.status,
        toStatus: to,
        details: { code: check.code, message: check.message },
        occurredAt: new Date(),
      },
    });
    return { kind: 'rejected', code: check.code, message: check.message, report };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // The version in the WHERE clause makes this safe even if two
      // coordinators click at the same moment: only one update matches.
      const result = await tx.report.updateMany({
        where: { id, version: expectedVersion },
        data: { status: to, version: { increment: 1 } },
      });
      if (result.count === 0) throw new Error('VERSION_CONFLICT');

      await tx.reportEvent.create({
        data: {
          reportId: id,
          type: 'status_changed',
          actor,
          fromStatus: report.status,
          toStatus: to,
          details: reason ? { reason } : Prisma.JsonNull,
          occurredAt: new Date(),
        },
      });
      return tx.report.findUniqueOrThrow({ where: { id } });
    });
    return { kind: 'ok', report: updated };
  } catch (e) {
    if (e instanceof Error && e.message === 'VERSION_CONFLICT') {
      const current = await prisma.report.findUnique({ where: { id } });
      if (current) return { kind: 'version_conflict', report: current };
    }
    throw e;
  }
}