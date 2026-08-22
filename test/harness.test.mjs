import { test } from "node:test";
import assert from "node:assert/strict";

test("verified aliases improve rank in Asciify's production lexical harness", {
  skip: process.env.GEN_TEST_FULL_HARNESS !== "1",
}, async () => {
  const { getHarness } = await import("../src/validate.mjs");
  const harness = await getHarness();
  const query = "lawyer apostrophe section squiggle";
  assert.equal(await harness(query, "167"), -1);
  assert.equal(await harness(query, "167", { aliases: [query] }), 1);
});
