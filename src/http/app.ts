import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from '../config/logger.js';

import { router } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.set('trust proxy', true);

  app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for webhook monitor
  }));
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

  // Serve static files from public directory
  app.use('/public', express.static(path.join(__dirname, '../../public')));

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
