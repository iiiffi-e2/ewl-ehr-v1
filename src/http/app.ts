import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { logger } from '../config/logger.js';

import { router } from './routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);

  app.use(helmet());
  app.use(
    express.json({
      limit: '1mb',
    }),
  );

  app.use(
    pinoHttp({
      logger,
      customLogLevel: function (res, err) {
        const statusCode = res.statusCode ?? 500;
        if (statusCode >= 500 || err) {
          return 'error';
        }
        if (statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
    }),
  );

  app.use(router);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error({ error: err.message, stack: err.stack }, 'unhandled_error');
      res.status(500).json({ error: 'Internal Server Error' });
    },
  );

  return app;
}
