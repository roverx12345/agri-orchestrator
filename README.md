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

That declaration already exists in `openclaw.plugin.json`, and the shipped skill lives at `skills/agri-orchestrator/SKILL.md`.

## Install

Prerequisites:

- Node.js 22+
- npm
- OpenClaw 2026.3.23-2 or newer

Recommended install flow from the repo root:

```bash
npm install
npm run typecheck
npm test
npm run build
./scripts/install-openclaw-plugin.sh
```

What the install script does:

- builds `dist/`
- installs the plugin from the current local path if needed
- enables the plugin if it is not already enabled
- prints `openclaw plugins info agri-orchestrator`

If you prefer to do it manually:

```bash
npm run build
openclaw plugins install -l "$(pwd)"
openclaw plugins enable agri-orchestrator
openclaw plugins info agri-orchestrator
```

## Minimal debug workflow

Validated local iteration flow:

```bash
npm run typecheck
npm test
npm run build
openclaw plugins info agri-orchestrator
```

If you changed plugin source and the host is already running, rebuild and then restart the OpenClaw gateway before retesting:

```bash
npm run build
./scripts/run-openclaw-gateway.sh
```

The install/debug commands above were re-checked locally in this repo:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `./scripts/install-openclaw-plugin.sh`

If the plugin loads but a tool is not behaving as expected, inspect:

- workspace JSON truth: `<workspace>/.agri-orchestrator/data/store.json`
- memory summaries: `<workspace>/memory/agri/*.md`

## Quick demo initialization

This repo includes both a demo data file and a script:

- `examples/demo-store.json`
- `scripts/init-demo.mjs`

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

## Practical OpenClaw TUI and Feishu examples

The same natural-language prompts can be used in OpenClaw TUI or in a Feishu chat that is wired to the OpenClaw gateway.

### Tested field registration flow

This flow was re-tested with a Chinese field location and crop plan:

```text
Please use the agri-orchestrator tools to create a field profile:
name "曲周小麦试验田B", kind field, location "河北邯郸曲周",
crop wheat, cultivar 济麦22, current stage heading.
Then record three observations:
1) today's soil_moisture is adequate;
2) latest soil_test shows low nitrogen;
3) today's pest_scout is low with no obvious disease or insect damage.
Reply only with "已完成".
```

Expected behavior:

- the plugin creates the unit and crop plan
- if the unit has only Chinese location text, it attempts geocoding automatically
- if geocoding succeeds, it backfills `latitude` / `longitude`
- if geocoding still fails, the assistant should ask for a more standard address or manual coordinates

### Tested risk question that does not mention weather explicitly

After weather sync or prompt-time refresh is available, the following style of prompt should still use tomorrow forecast context:

```text
请直接告诉我曲周小麦试验田B今天的主要风险，并给出处理优先级。不要先问我补充信息，直接基于现有档案回答。
```

Expected behavior:

- the model can cite tomorrow weather context even when the user did not explicitly ask about weather
- risk ranking should combine agronomy records and tomorrow forecast
- the weather line comes from the native plugin prompt summary, not from the user manually typing weather

### Feishu-friendly message examples

Use messages like these directly in the Feishu OpenClaw chat:

```text
请帮我新建一个农田档案：名称“曲周小麦试验田B”，类型 field，位置“河北邯郸曲周”，作物 wheat，品种 济麦22，当前阶段 heading。
```

```text
请帮我记录三条观察到曲周小麦试验田B：1）今天 soil_moisture 为 adequate；2）最新 soil_test 显示 low nitrogen；3）今天 pest_scout 为 low，没有明显病虫害。
```

```text
请告诉我曲周小麦试验田B今天的主要风险和今日建议。
```

```text
请告诉我曲周小麦试验田B明天是否有天气相关风险，并说明今天该提前做什么。
```

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
