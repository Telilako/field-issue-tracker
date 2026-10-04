import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { syncRouter } from './syncRoute';
import { reportsRouter } from './reportsRoute';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api', syncRouter);
  app.use('/api', reportsRouter);

  // Must come last. Turns any error into the standard { error: {...} } shape.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  });

  return app;
}