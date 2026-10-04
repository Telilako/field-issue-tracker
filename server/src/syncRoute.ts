import { Router } from 'express';
import { syncReport } from './syncService';

export const syncRouter = Router();

syncRouter.post('/sync/reports', async (req, res, next) => {
  try {
    const actor = String(req.header('x-user') ?? 'field-worker');
    const result = await syncReport(req.body, actor);

    switch (result.kind) {
      case 'created':
        return res.status(201).json({ status: 'created', report: result.report });
      case 'duplicate':
        return res.status(200).json({ status: 'duplicate', report: result.report });
      case 'conflict':
        return res.status(409).json({
          error: { code: 'ID_CONFLICT', message: 'A different report with this id already exists on the server.' },
          report: result.report,
        });
      case 'invalid':
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'The report has invalid fields.', fields: result.errors },
        });
    }
  } catch (e) {
    next(e);
  }
});