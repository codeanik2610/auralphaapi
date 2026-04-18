import { access, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Service } from 'typedi';
import { env } from '../../env';

type FileHandle = Awaited<ReturnType<typeof open>>;

@Service()
export class ActivityExportStorageService {
  getStorageMode(): 'filesystem' {
    return env.activity.exportStorageMode;
  }

  async pathExists(storagePath: string): Promise<boolean> {
    try {
      await access(storagePath);
      return true;
    } catch {
      return false;
    }
  }

  async materializeTextContent(
    item: {
      id: string;
      fileName: string;
      content: string;
    }
  ): Promise<string> {
    const filePath = await this.resolveFilePath(item.id, item.fileName);
    await writeFile(filePath, item.content, 'utf8');
    return filePath;
  }

  async openWritableExportFile(
    item: {
      id: string;
      fileName: string;
    }
  ): Promise<{ filePath: string; file: FileHandle }> {
    const filePath = await this.resolveFilePath(item.id, item.fileName);
    const file = await open(filePath, 'w');
    return { filePath, file };
  }

  async deleteStoredFile(storagePath: string): Promise<void> {
    await unlink(storagePath);
  }

  private async resolveFilePath(id: string, fileName: string): Promise<string> {
    const storageDir = this.getStorageDir();
    await mkdir(storageDir, { recursive: true });
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
    return path.join(storageDir, `${id}-${safeFileName}`);
  }

  private getStorageDir(): string {
    if (env.activity.exportStorageMode !== 'filesystem') {
      throw new Error(
        `Unsupported activity export storage mode: ${env.activity.exportStorageMode}`
      );
    }

    if (!env.activity.exportStorageDir) {
      throw new Error('ACTIVITY_EXPORT_STORAGE_DIR is required for filesystem export storage');
    }

    return env.activity.exportStorageDir;
  }
}
