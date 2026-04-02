# agri-orchestrator

`agri-orchestrator` is a native OpenClaw plugin for agriculture and horticulture operations. It keeps the source of truth inside the workspace, uses structured data plus crop-specific rule packages for decisions, and keeps high-risk actions behind explicit confirmation.

Chinese user guide for non-technical users: `README.zh-CN.md`

The MVP is intentionally narrow but runnable:

- register production units and crop plans
- log observations and operations
- run `agri_care_check`
- persist JSON truth plus Markdown memory
- support crop packages for `hyacinth`, `corn`, and `wheat`
- fall back to conservative mode for unsupported crops or missing critical inputs

## OpenClaw compatibility

Tested against `openclaw@2026.3.23-2`.

Confirmed native plugin surfaces used in this repo:

- `openclaw.plugin.json`
- `register(api)`
- `api.registerTool(...)`
- `api.on("before_prompt_build", ...)`
- `api.registerHttpRoute(...)`

No OpenClaw core patching is required.

## Plugin layout

```text
agri-orchestrator/
├── examples/
│   └── demo-store.json
├── index.ts
├── openclaw.plugin.json
├── package.json
├── README.md
├── scripts/
│   └── init-demo.mjs
├── skills/
│   └── agri-orchestrator/
│       └── SKILL.md
├── src/
│   ├── domain/
│   │   └── rules/
│   ├── http.ts
│   ├── schema.ts
│   ├── store.ts
│   ├── tooling.ts
│   ├── rules.ts
│   └── types.ts
└── test/
    ├── helpers.ts
    └── plugin.test.ts
```

Runtime data is written to the active workspace:

```text
<workspace>/.agri-orchestrator/data/store.json
<workspace>/memory/agri/*.md
```

## Skills declaration

This plugin ships its own skill and declares it with the current manifest shape:

```json
{
  "skills": ["./skills"]
}
```

That declaration already exists in [openclaw.plugin.json](/Users/roverx/Documents/app/agri-orchestrator/openclaw.plugin.json), and the shipped skill lives at [skills/agri-orchestrator/SKILL.md](/Users/roverx/Documents/app/agri-orchestrator/skills/agri-orchestrator/SKILL.md).

## Install

1. Install local dependencies:

```bash
npm install
```

2. Install the plugin into OpenClaw from the local path:

```bash
openclaw plugins install -l /Users/roverx/Documents/app/agri-orchestrator
```

3. Enable it:

```bash
openclaw plugins enable agri-orchestrator
```

4. Verify the plugin is visible:

```bash
openclaw plugins info agri-orchestrator
```

## Minimal debug workflow

Use these commands while iterating:

```bash
npm run typecheck
npm test
openclaw plugins info agri-orchestrator
```

If the plugin loads but a tool is not behaving as expected, inspect:

- workspace JSON truth: `<workspace>/.agri-orchestrator/data/store.json`
- memory summaries: `<workspace>/memory/agri/*.md`

## Quick demo initialization

This repo includes both a demo data file and a script:

- [examples/demo-store.json](/Users/roverx/Documents/app/agri-orchestrator/examples/demo-store.json)
- [scripts/init-demo.mjs](/Users/roverx/Documents/app/agri-orchestrator/scripts/init-demo.mjs)

The demo initializes:

- one `hyacinth` container plan
- one `corn` field plan
- one `wheat` field plan

Run it against a target workspace directory:

```bash
npm run demo:init -- /absolute/path/to/workspace
```

If no path is given, it uses the current working directory.

## Tool inventory

The plugin registers these tools:

- `agri_register_unit`
- `agri_register_crop_plan`
- `agri_log_observation`
- `agri_log_operation`
- `agri_care_check`

High-risk operations are blocked unless `confirmed=true`:

- `spraying`
- `harvest`
- `postharvest`

## End-to-end example

The following shows a minimal tool-driven flow from setup to action logging.

### 1. Register a production unit

Tool: `agri_register_unit`

```json
{
  "name": "Balcony Hyacinth Pot",
  "kind": "container",
  "location": "east balcony",
  "notes": "single decorative bulb container"
}
```

### 2. Register a crop plan

Tool: `agri_register_crop_plan`

```json
{
  "unitId": "unit_hyacinth_container",
  "crop": "hyacinth",
  "cultivar": "Delft Blue",
  "currentStage": "flowering",
  "notes": "forcing bulb in a patio container"
}
```

### 3. Record an observation

Tool: `agri_log_observation`

```json
{
  "cropPlanId": "plan_hyacinth_container",
  "type": "soil_moisture",
  "observedAt": "2026-03-17T08:00:00.000Z",
  "summary": "Moisture is adequate",
  "data": {
    "status": "adequate"
  }
}
```

### 4. Run the care check

Tool: `agri_care_check`

```json
{
  "scope": "planId",
  "planId": "plan_hyacinth_container",
  "persistRecommendations": true
}
```

Expected behavior:

- the plugin selects the `hyacinth` crop package automatically
- if critical inputs are missing, it enters conservative mode
- if inputs are sufficient, it returns package-driven recommendations

### 5. Record an executed operation

Tool: `agri_log_operation`

```json
{
  "cropPlanId": "plan_hyacinth_container",
  "type": "irrigation",
  "performedAt": "2026-03-17T09:00:00.000Z",
  "summary": "Light watering after container check",
  "confirmed": true
}
```

### 6. High-risk example

If a harvest really happened, log it explicitly:

```json
{
  "cropPlanId": "plan_wheat_field",
  "type": "harvest",
  "performedAt": "2026-07-08T08:30:00.000Z",
  "summary": "Combine pass completed on the south block",
  "confirmed": true
}
```

Without `confirmed=true`, this will be blocked.

## Cron example

Current OpenClaw exposes cron as a Gateway capability, not as a plugin-side `registerCron(...)` API. The recommended MVP pattern is to let OpenClaw cron trigger a dedicated agent turn that uses this plugin’s tools.

### Daily 07:00 inspection

```bash
openclaw cron add \
  --name "Daily agri check" \
  --cron "0 7 * * *" \
  --session isolated \
  --message "Run agri_care_check with scope=all for the current workspace. Summarize only high and medium severity items, list requiredInputs still missing, and do not mark any action as completed unless it has been logged with agri_log_operation."
```

### Why isolated session is preferred

Use `--session isolated` for recurring inspections so:

- the main session history does not bloat
- each run is traceable as a cron-specific turn
- failures or noisy recommendations do not pollute the main conversation

## HTTP route

The plugin registers:

- `GET /agri/ingest`
- `POST /agri/ingest`

This is only a placeholder for future sensor or scouting ingestion. `GET` returns a status payload and `POST` returns `501 Not Implemented`.

## Rule engine overview

The rule engine is split into crop packages under `src/domain/rules/packages/`.

Implemented crop packages:

- `hyacinth`
- `corn`
- `wheat`

Fallback mode:

- unsupported crop -> generic conservative mode
- missing critical inputs -> conservative mode even for supported crop packages

## Tests

Run:

```bash
npm test
```

The current suite covers:

- register/log tools write `store.json`
- high-risk operation blocking
- adapted crop package selection
- generic fallback for unsupported crops
- conservative mode for missing critical inputs

## Tomorrow weather context in the native plugin

The native OpenClaw plugin can now cache a tomorrow forecast per active unit and inject a short weather line into the prompt context. The flow is:

1. reuse a fresh cached forecast when available
2. refresh stale weather automatically during prompt construction
3. give the model a stable tomorrow-weather reference for risk questions
4. attempt to geocode Chinese location text and backfill coordinates; if that still fails, prompt the user for a more standard address or manual latitude/longitude

To refresh the workspace weather cache on a daily schedule:

```bash
npm run build
npm run weather:sync -- /path/to/openclaw-workspace
```

Example cron entry:

```cron
0 18 * * * cd /path/to/agri-orchestrator-main && npm run build >/tmp/agri-build.log 2>&1 && npm run weather:sync -- /path/to/openclaw-workspace >/tmp/agri-weather-sync.log 2>&1
```

If `latitude` / `longitude` are already stored on the unit, the sync uses them directly; otherwise it geocodes the unit `location`.

## Data model

Structured entities:

- `ProductionUnit`
- `CropPlan`
- `Observation`
- `Operation`
- `Recommendation`

Supported production unit kinds:

- `field`
- `greenhouse`
- `orchard`
- `container`
- `nursery`

Supported observation types:

- `weather`
- `soil_moisture`
- `soil_test`
- `tissue_test`
- `pest_scout`
- `disease_scout`
- `weed_scout`
- `phenology`
- `quality`

Supported operation types:

- `land_prep`
- `sowing`
- `transplanting`
- `irrigation`
- `fertilization`
- `spraying`
- `pruning`
- `weeding`
- `harvest`
- `postharvest`

## 已完成

- native OpenClaw plugin skeleton
- manifest + tool registration + prompt hook + HTTP route
- workspace JSON persistence + Markdown memory summaries
- crop package abstraction
- `hyacinth`, `corn`, `wheat` packages
- generic conservative fallback
- demo initialization script and demo store
- install, debug, end-to-end, and cron documentation
- backend weather forecast ingest for field warnings

## 未完成

- sensor SDK ingestion
- multi-user permission model
- compliance-specific agronomy rules
- richer crop database and cultivar knowledge
- more detailed harvest/postharvest packages

## 后续扩展

- expand crop package coverage beyond the current 3 crops
- replace heuristic stage parsing with stage dictionaries or rule tables
- add richer soil test and tissue test interpretation
- add package-level irrigation and nutrient thresholds
- implement real ingest processing behind `/agri/ingest`
