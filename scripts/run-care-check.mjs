import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

function materializeTool(tools, name, ctx) {
  const found = tools.find((tool) => {
    if (typeof tool === "function") {
      const materialized = tool(ctx);
      return Array.isArray(materialized)
        ? materialized.some((item) => item.name === name)
        : materialized?.name === name;
    }
    return tool.name === name;
  });

  if (!found) {
    throw new Error(`Tool ${name} was not registered.`);
  }

  if (typeof found === "function") {
    const materialized = found(ctx);
    if (Array.isArray(materialized)) {
      const matched = materialized.find((item) => item.name === name);
      if (!matched) {
        throw new Error(`Tool factory did not materialize ${name}.`);
      }
      return matched;
    }
    return materialized;
  }

  return found;
}

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const workspaceDir = path.resolve(process.argv[2] ?? process.cwd());
  const planId = process.argv[3];
  const tools = [];
  const buildDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-dist-"));

  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "--project",
      path.join(repoRoot, "tsconfig.json"),
      "--outDir",
      buildDir,
      "--noEmit",
      "false",
      "--declaration",
      "false",
      "--sourceMap",
      "false",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  try {
    const { default: plugin } = await import(pathToFileUrl(path.join(buildDir, "index.js")).href);

    const api = {
      id: "agri-orchestrator",
      name: "Agri Orchestrator",
      description: "script",
      source: "script",
      config: {},
      pluginConfig: {},
      runtime: {},
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      registerTool(tool) {
        tools.push(tool);
      },
      registerHook() {},
      registerHttpRoute() {},
      registerChannel() {},
      registerGatewayMethod() {},
      registerCli() {},
      registerService() {},
      registerProvider() {},
      registerCommand() {},
      registerContextEngine() {},
      resolvePath(input) {
        return input;
      },
      on() {},
    };

    plugin.register(api);

    const careCheck = materializeTool(tools, "agri_care_check", { workspaceDir });
    const result = await careCheck.execute("script-care-check", {
      scope: planId ? "planId" : "all",
      planId,
      persistRecommendations: false,
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
}

function pathToFileUrl(input) {
  const resolved = path.resolve(input);
  return new URL(`file://${resolved}`);
}

main().catch((error) => {
  console.error("failed to run care check");
  console.error(error);
  process.exitCode = 1;
});
