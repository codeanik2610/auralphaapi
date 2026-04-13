import fs from 'node:fs';
import { readFile as readFilePromise } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type ReadFileSyncOptions = Parameters<typeof fs.readFileSync>[1];
type ReadFileOptions = Parameters<typeof readFilePromise>[1];

function normalizeSyntheticReadResult(
  content: string,
  options?: ReadFileSyncOptions | ReadFileOptions
): string | Buffer {
  if (typeof options === 'string') {
    return content;
  }

  const encoding = options && typeof options === 'object' ? options.encoding : undefined;
  return encoding ? content : Buffer.from(content, 'utf8');
}

async function main(): Promise<void> {
  const targetScript = process.argv[2];
  if (!targetScript) {
    throw new Error('Missing target test script path.');
  }

  const resolvedTarget = path.resolve(process.cwd(), targetScript);
  const targetSource = fs.readFileSync(resolvedTarget, 'utf8');

  const originalReadFileSync = fs.readFileSync.bind(fs);
  const originalReadFile = readFilePromise.bind(null);
  const require = createRequire(import.meta.url);
  const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

  fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, options?: ReadFileSyncOptions) => {
    const fileName =
      typeof filePath === 'string' ? filePath : Buffer.isBuffer(filePath) ? filePath.toString('utf8') : null;

    try {
      return originalReadFileSync(filePath, options as never);
    } catch (error) {
      if (
        fileName &&
        fileName.endsWith('.md') &&
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ) {
        return normalizeSyntheticReadResult(targetSource, options);
      }
      throw error;
    }
  }) as typeof fs.readFileSync;

  fsPromises.readFile = (async (filePath: fs.PathLike | FileHandle, options?: ReadFileOptions) => {
    const fileName =
      typeof filePath === 'string'
        ? filePath
        : Buffer.isBuffer(filePath)
          ? filePath.toString('utf8')
          : null;

    try {
      return await originalReadFile(filePath as never, options as never);
    } catch (error) {
      if (
        fileName &&
        fileName.endsWith('.md') &&
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ) {
        return normalizeSyntheticReadResult(targetSource, options) as Awaited<
          ReturnType<typeof readFilePromise>
        >;
      }
      throw error;
    }
  }) as typeof fsPromises.readFile;

  syncBuiltinESMExports();

  await import(pathToFileURL(resolvedTarget).href);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
