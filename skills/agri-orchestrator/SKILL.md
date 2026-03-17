# agri-orchestrator

Use this skill when the user is managing crops, fields, greenhouses, orchards, nursery stock, or container gardening over time.

## What this plugin is for

- Tracking production units such as fields, greenhouses, orchards, containers, and nurseries.
- Tracking crop plans, growth stage, observations, operations, and rule-based care recommendations.
- Running daily or routine agronomy checks from structured workspace data.

## Tool selection

- Use `agri_register_unit` before giving unit-specific advice if the field, container, greenhouse, orchard, or nursery is not yet registered.
- Use `agri_register_crop_plan` before giving crop-stage advice if no crop plan exists for the production unit.
- Use `agri_log_observation` to record scouting, phenology, moisture, weather, quality, or test data.
- Use `agri_log_operation` to record actual work that was performed.
- Use `agri_care_check` when the user asks what to do next, wants a daily inspection, or wants a structured recommendation set.

## Operating rules

- Prefer structured tool calls over free-text memory. If a production fact matters later, write it with a tool.
- If critical inputs are missing, gather or register them first, then run `agri_care_check`.
- Do not present irrigation, fertilization, spraying, harvest, or postharvest work as completed unless it has been logged with `agri_log_operation`.
- `spraying`, `harvest`, and `postharvest` are high-risk operations. They must only be logged when the user explicitly confirms the action and `confirmed=true` is provided.
- When recommendations mention missing `requiredInputs`, ask for or collect those inputs instead of pretending certainty.

## Response pattern

1. Register missing units or crop plans if needed.
2. Log new observations before changing recommendations.
3. Run `agri_care_check` for advice.
4. If the user confirms an action was actually done, log it with `agri_log_operation`.

