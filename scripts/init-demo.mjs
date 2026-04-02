import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceStorePath = path.join(repoRoot, "examples", "demo-store.json");
const targetWorkspace = path.resolve(process.argv[2] ?? process.cwd());
const targetStorePath = path.join(targetWorkspace, ".agri-orchestrator", "data", "store.json");
const targetMemoryDir = path.join(targetWorkspace, "memory", "agri");
const targetMemoryFile = path.join(targetMemoryDir, "demo-seed.md");

async function main() {
  const raw = await fs.readFile(sourceStorePath, "utf8");
  const store = JSON.parse(raw);

  await fs.mkdir(path.dirname(targetStorePath), { recursive: true });
  await fs.mkdir(targetMemoryDir, { recursive: true });
  await fs.writeFile(targetStorePath, JSON.stringify(store, null, 2), "utf8");
  await fs.writeFile(
    targetMemoryFile,
    [
      "# agri-orchestrator demo seed",
      "",
      "- Seeded hyacinth container demo plan",
      "- Seeded corn field demo plan",
      "- Seeded wheat field demo plan",
      "",
      `Store: ${targetStorePath}`,
      ""
    ].join("\n"),
    "utf8",
  );

  process.stdout.write(
    [
      "agri-orchestrator demo workspace initialized",
      `workspace: ${targetWorkspace}`,
      `store: ${targetStorePath}`,
      `memory: ${targetMemoryFile}`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  console.error("failed to initialize demo workspace");
  console.error(error);
  process.exitCode = 1;
});
