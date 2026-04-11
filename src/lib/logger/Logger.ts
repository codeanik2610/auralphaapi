import * as path from 'node:path';
import * as winston from 'winston';

export class Logger {
  public static DEFAULT_SCOPE = 'app';
  private readonly scope: string;

  constructor(scope?: string) {
    this.scope = Logger.parsePathToScope(scope || Logger.DEFAULT_SCOPE);
  }

  private static parsePathToScope(filepath: string): string {
    if (filepath.indexOf(path.sep) >= 0) {
      filepath = filepath.replace(process.cwd(), '');
      filepath = filepath.replace(`${path.sep}src${path.sep}`, '');
      filepath = filepath.replace(`${path.sep}dist${path.sep}`, '');
      filepath = filepath.replace('.ts', '');
      filepath = filepath.replace('.js', '');
      filepath = filepath.split(path.sep).join(':');
    }

    return filepath;
  }

  public debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  public error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, args: unknown[]): void {
    winston[level](`${this.formatScope()} ${message}`, ...args);
  }

  private formatScope(): string {
    return `[${this.scope}]`;
  }
}
