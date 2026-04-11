import { env } from '../env';
import { Logger } from './logger';

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
};

const style = (value: string, color: string, bold = false): string =>
  `${bold ? ansi.bold : ''}${color}${value}${ansi.reset}`;

export function banner(log: Logger): void {
  const route = () => `${env.app.schema}://${env.app.host}:${env.app.port}`;

  if (!env.app.banner) {
    log.info('Application is up and running.');
    return;
  }

  log.info('');
  log.info(style(`Aloha, your app is ready on ${route()}${env.app.routePrefix}`, ansi.green, true));
  log.info(style('To shut it down, press <CTRL> + C at any time.', ansi.yellow));
  log.info('');
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info(`${style('Environment  :', ansi.cyan, true)} ${env.node}`);
  log.info(`${style('App Name     :', ansi.cyan, true)} ${env.app.name}`);
  log.info(`${style('API Info     :', ansi.cyan, true)} ${route()}${env.app.routePrefix}`);
  log.info(style('-------------------------------------------------------', ansi.cyan));
  log.info('');
}
