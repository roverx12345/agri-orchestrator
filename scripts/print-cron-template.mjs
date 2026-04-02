import process from "node:process";

const cronExpr = process.argv[2] ?? "0 7 * * *";
const message =
  "Run agri_care_check with scope=all for the current workspace. Summarize only high and medium severity items, list missing requiredInputs, and do not mark any action as completed unless it has already been logged with agri_log_operation.";

process.stdout.write(
  [
    "Recommended OpenClaw cron command:",
    "",
    "openclaw cron add \\",
    '  --name "Daily agri check" \\',
    `  --cron "${cronExpr}" \\`,
    '  --session isolated \\',
    `  --message "${message}"`,
    "",
  ].join("\n"),
);
