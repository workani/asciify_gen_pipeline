// A record includes generation and fresh review; proposals never become the
// unattended output merely because the legacy enrichment stage completed.
export const AUTOPILOT_STAGES = Object.freeze(["records"]);

export async function runAutopilotWave({ runStage, waveEntities, onPhase = null }) {
  if (typeof runStage !== "function") throw new TypeError("runAutopilotWave requires runStage");
  const completed = {};
  for (const stage of AUTOPILOT_STAGES) {
    onPhase?.({ stage, waveEntities, completed: { ...completed } });
    completed[stage] = await runStage(stage, waveEntities);
  }
  return completed;
}
