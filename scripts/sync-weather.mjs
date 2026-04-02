#!/usr/bin/env node
import path from 'node:path';

const workspaceArg = process.argv[2];
const workspaceDir = workspaceArg ? path.resolve(workspaceArg) : process.cwd();

const { syncWorkspaceWeather } = await import('../dist/src/weather.js');

const result = await syncWorkspaceWeather(workspaceDir);

console.log(JSON.stringify({
  ok: result.errors.length === 0,
  workspaceDir,
  updatedUnitIds: result.updatedUnitIds,
  skippedUnitIds: result.skippedUnitIds,
  errors: result.errors,
  storePath: result.storePath ?? null,
}, null, 2));
