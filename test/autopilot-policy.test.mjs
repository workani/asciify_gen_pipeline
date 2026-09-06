import test from "node:test";
import assert from "node:assert/strict";
import { AUTOPILOT_STAGES, runAutopilotWave } from "../src/autopilot.mjs";

test("unattended policy runs reviewed records and never legacy proposals", async () => {
  const calls = [];
  const phases = [];
  const completed = await runAutopilotWave({
    waveEntities: 100,
    runStage: async (stage, limit) => {
      calls.push({ stage, limit });
      return 72;
    },
    onPhase: ({ stage }) => phases.push(stage),
  });

  assert.deepEqual(AUTOPILOT_STAGES, ["records"]);
  assert.deepEqual(calls, [
    { stage: "records", limit: 100 },
  ]);
  assert.deepEqual(phases, ["records"]);
  assert.deepEqual(completed, { records: 72 });
});
