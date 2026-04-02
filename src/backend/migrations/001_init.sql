CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('container', 'field', 'greenhouse', 'orchard', 'nursery', 'bed')),
  location_text TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geometry_geojson JSONB,
  area_m2 DOUBLE PRECISION,
  container_info JSONB,
  irrigation_method TEXT,
  owner_ref TEXT,
  project_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  profile_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_type ON units(type);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);
CREATE INDEX IF NOT EXISTS idx_units_owner_ref ON units(owner_ref);
CREATE INDEX IF NOT EXISTS idx_units_project_ref ON units(project_ref);

CREATE TABLE IF NOT EXISTS crop_plans (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  crop TEXT NOT NULL,
  cultivar TEXT,
  sowing_date DATE,
  transplant_date DATE,
  current_stage TEXT,
  target TEXT CHECK (target IN ('yield', 'ornamental', 'quality', 'water-saving')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crop_plans_unit_id ON crop_plans(unit_id);
CREATE INDEX IF NOT EXISTS idx_crop_plans_active ON crop_plans(active);
CREATE INDEX IF NOT EXISTS idx_crop_plans_crop ON crop_plans(crop);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  crop_plan_id TEXT REFERENCES crop_plans(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'coworker', 'background', 'sensor', 'api')),
  type TEXT NOT NULL CHECK (type IN ('image', 'text_note', 'soil_moisture', 'weather', 'soil_test', 'pest_scout', 'disease_scout', 'phenology', 'quality', 'yield')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachment_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_flag TEXT CHECK (quality_flag IN ('ok', 'suspect', 'missing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_observations_unit_id ON observations(unit_id);
CREATE INDEX IF NOT EXISTS idx_observations_crop_plan_id ON observations(crop_plan_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source);
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at DESC);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  crop_plan_id TEXT REFERENCES crop_plans(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('water', 'nutrition', 'pest', 'disease', 'weed', 'harvest', 'compliance', 'general')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'watch', 'action', 'urgent')),
  rationale JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION NOT NULL,
  needs_human_confirm BOOLEAN NOT NULL DEFAULT FALSE,
  engine TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_unit_id ON recommendations(unit_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_crop_plan_id ON recommendations(crop_plan_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_generated_at ON recommendations(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_category ON recommendations(category);
CREATE INDEX IF NOT EXISTS idx_recommendations_severity ON recommendations(severity);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  crop_plan_id TEXT REFERENCES crop_plans(id) ON DELETE SET NULL,
  reminder_type TEXT NOT NULL,
  schedule_basis TEXT NOT NULL CHECK (schedule_basis IN ('rule', 'manual', 'recurring', 'forecast-triggered')),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'done', 'skipped', 'expired')),
  linked_recommendation_id TEXT REFERENCES recommendations(id) ON DELETE SET NULL,
  recurrence_rule JSONB,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_unit_id ON reminders(unit_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_at ON reminders(due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_recommendation ON reminders(linked_recommendation_id);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  crop_plan_id TEXT REFERENCES crop_plans(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('irrigation', 'fertilization', 'spraying', 'weeding', 'pruning', 'harvest', 'postharvest', 'scouting')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  linked_recommendation_id TEXT REFERENCES recommendations(id) ON DELETE SET NULL,
  linked_reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_unit_id ON operation_logs(unit_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_crop_plan_id ON operation_logs(crop_plan_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_type ON operation_logs(type);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_linked_recommendation_id ON operation_logs(linked_recommendation_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_linked_reminder_id ON operation_logs(linked_reminder_id);

CREATE TABLE IF NOT EXISTS background_snapshots (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('raw', 'normalized', 'feature')),
  source TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_flag TEXT CHECK (quality_flag IN ('ok', 'suspect', 'missing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_snapshots_unit_id ON background_snapshots(unit_id);
CREATE INDEX IF NOT EXISTS idx_background_snapshots_date ON background_snapshots(date DESC);
CREATE INDEX IF NOT EXISTS idx_background_snapshots_layer ON background_snapshots(layer);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  format TEXT NOT NULL CHECK (format IN ('csv')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  output_path TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_created_at ON export_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
