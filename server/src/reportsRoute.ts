import { Router } from 'express';
import { getReport, listReports, transitionReport } from './reportsService';

export const reportsRouter = Router();

reportsRouter.get('/reports', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    res.json({ reports: await listReports({ status, priority }) });
  } catch (e) {
    next(e);
  }
});

reportsRouter.get('/reports/:id', async (req, res, next) => {
  try {
    const report = await getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found.' } });
    }
    res.json({ report });
  } catch (e) {
    next(e);
  }
});

reportsRouter.post('/reports/:id/transition', async (req, res, next) => {
  try {
    const actor = String(req.header('x-user') ?? 'coordinator');
    const role = String(req.header('x-role') ?? 'field-worker');
    const result = await transitionReport(req.params.id, req.body ?? {}, actor, role);

    switch (result.kind) {
      case 'ok':
        return res.json({ report: result.report });
      case 'not_found':
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found.' } });
      case 'forbidden':
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Only a coordinator can change a report status.' },
        });
      case 'bad_request':
        return res.status(400).json({ error: { code: result.code, message: result.message } });
      case 'rejected':
        return res.status(409).json({
          error: { code: result.code, message: result.message },
          report: result.report,
        });
      case 'version_conflict':
        return res.status(409).json({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'This report was changed by someone else. Reload it and try again.',
          },
          report: result.report,
        });
    }
  } catch (e) {
    next(e);
  }
});