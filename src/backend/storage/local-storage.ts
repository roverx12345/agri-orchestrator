import fs from "node:fs/promises";
import path from "node:path";
import { makeId } from "../utils.js";

export type SavedFile = {
  path: string;
  originalName: string;
  contentType?: string;
  sizeBytes: number;
};

export class LocalFileStorage {
  constructor(private readonly rootDir: string) {}

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(path.join(this.rootDir, "uploads"), { recursive: true });
    await fs.mkdir(path.join(this.rootDir, "exports"), { recursive: true });
  }

  resolvePath(relativePath: string): string {
    return path.join(this.rootDir, relativePath);
  }

  async saveUpload(params: {
    originalName: string;
    contentType?: string;
    buffer: Buffer;
    folder?: string;
  }): Promise<SavedFile> {
    const folder = params.folder ?? "uploads";
    const extension = path.extname(params.originalName || "") || "";
    const filename = `${makeId("file")}${extension}`;
    const relativePath = path.join(folder, filename);
    const absolutePath = this.resolvePath(relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, params.buffer);

    return {
      path: relativePath,
      originalName: params.originalName,
      contentType: params.contentType,
      sizeBytes: params.buffer.byteLength,
    };
  }

  async writeExport(filename: string, content: string): Promise<string> {
    const relativePath = path.join("exports", filename);
    const absolutePath = this.resolvePath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
    return relativePath;
  }
}
