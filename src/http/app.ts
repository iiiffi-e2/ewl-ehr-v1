import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
  // In production (dist/http/app.js), __dirname is /app/dist/http, public is at /app/dist/public
  // So we need to go up one level: ../public
  // In development (src/http/app.ts), __dirname is /path/to/src/http, public is at /path/to/public
  // So we need to go up two levels: ../../public
  
  // Check if we're in production (dist folder) or development (src folder)
  const isProduction = __dirname.includes('/dist/') || __dirname.includes('\\dist\\');
  const publicPath = isProduction 
    ? path.join(__dirname, '../public')  // dist/http -> dist/public
    : path.join(__dirname, '../../public'); // src/http -> public
  
  const publicExists = fs.existsSync(publicPath);
  
  logger.info({ 
    publicPath, 
    publicExists,
    __dirname,
    isProduction,
    resolvedPath: path.resolve(publicPath)
  }, 'static_files_configuration');

  if (publicExists) {
    app.use('/public', express.static(publicPath));
    logger.info('static_files_middleware_registered');
  } else {
    logger.error({ publicPath }, 'public_directory_not_found');
  }

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
