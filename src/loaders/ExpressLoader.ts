import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import { MicroframeworkLoader, MicroframeworkSettings } from 'microframework-w3tec';
import { useExpressServer } from 'routing-controllers';
import { env } from '../env';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

export const expressLoader: MicroframeworkLoader = (
  settings: MicroframeworkSettings | undefined
) => {
  if (!settings) {
    return;
  }

  const corsOptions =
    env.app.corsOrigins.length > 0
      ? {
          origin: env.app.corsOrigins,
        }
      : false;

  const expressApp: Application = express();

  expressApp.disable('x-powered-by');

  // Backward/alternate scheduler route aliases still retained for live clients where still supported.
  // routing-controllers' `routePrefix` does not apply to this middleware, so we match full paths.
  expressApp.use((request, _response, next) => {
    const prefix = env.app.routePrefix || '';
    const url = request.url || '';
    if (url.startsWith(`${prefix}/scheduler/orders-sync`)) {
      request.url = url.replace(`${prefix}/scheduler/orders-sync`, `${prefix}/scheduler/orders`);
    }
    next();
  });

  expressApp.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  if (corsOptions) {
    expressApp.use(cors(corsOptions));
  }

  useExpressServer(expressApp, {
    cors: false,
    classTransformer: true,
    routePrefix: env.app.routePrefix,
    defaultErrorHandler: false,
    controllers: env.app.dirs.controllers,
    middlewares: env.app.dirs.middlewares,
  });

  if (!env.isTest) {
    const server = expressApp.listen(env.app.port, () => {
      log.info(`HTTP server listening on port ${env.app.port}`);
    });
    settings.setData('express_server', server);
  }

  settings.setData('app', expressApp);
};
