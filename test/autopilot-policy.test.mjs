import test from "node:test";
import assert from "node:assert/strict";
import { AUTOPILOT_STAGES, runAutopilotWave } from "../src/autopilot.mjs";

test("unattended policy runs only blind ground then enrich", async () => {
  const calls = [];
  const phases = [];
  const completed = await runAutopilotWave({
    waveEntities: 100,
    runStage: async (stage, limit) => {
      calls.push({ stage, limit });
      return stage === "blind_ground" ? 80 : 72;
    },
    onPhase: ({ stage }) => phases.push(stage),
  });

  assert.deepEqual(AUTOPILOT_STAGES, ["blind_ground", "enrich"]);
  assert.deepEqual(calls, [
    { stage: "blind_ground", limit: 100 },
    { stage: "enrich", limit: 100 },
  ]);
  assert.deepEqual(phases, ["blind_ground", "enrich"]);
  assert.deepEqual(completed, { blind_ground: 80, enrich: 72 });
});
