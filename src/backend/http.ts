import type { FastifyRequest } from "fastify";
import type { AttachmentRef } from "./domain.js";
import { asJsonObject } from "./domain.js";
import { LocalFileStorage } from "./storage/local-storage.js";
import { makeId, safeJsonParse } from "./utils.js";

export function bodyAsRecord(request: FastifyRequest): Record<string, unknown> {
  return asJsonObject(request.body);
}

export async function readMultipartPayload(request: FastifyRequest, storage: LocalFileStorage): Promise<{ body: Record<string, unknown>; attachments: AttachmentRef[] }> {
  const parts = request.parts();
  const body: Record<string, unknown> = {};
  const attachments: AttachmentRef[] = [];

  for await (const part of parts) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      const saved = await storage.saveUpload({
        originalName: part.filename,
        contentType: part.mimetype,
        buffer,
      });
      attachments.push({
        id: makeId("att"),
        kind: "upload",
        path: saved.path,
        originalName: saved.originalName,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
      });
      continue;
    }

    if (part.fieldname === "payload") {
      Object.assign(body, safeJsonParse<Record<string, unknown>>(String(part.value), {}));
    } else {
      body[part.fieldname] = part.value;
    }
  }

  return { body, attachments };
}
