import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginLogger } from "openclaw/plugin-sdk";

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): true {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
  return true;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createAgriIngestHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET") {
      return writeJson(res, 200, {
        ok: true,
        plugin: "agri-orchestrator",
        route: "/agri/ingest",
        message: "Ingest route is enabled. Sensor and scouting ingestion is not implemented in this MVP.",
      });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      logger.info(`agri-orchestrator received ingest payload (${body.length} bytes)`);

      return writeJson(res, 501, {
        ok: false,
        accepted: false,
        message:
          "POST /agri/ingest is reserved for future sensor or scouting ingestion and is not implemented in this MVP.",
      });
    }

    res.statusCode = 405;
    res.setHeader("allow", "GET, POST");
    res.end("Method Not Allowed");
    return true;
  };
}
