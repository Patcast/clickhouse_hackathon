import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const htmlUrl = new URL("../analytics_engine/public/index.html", import.meta.url);
const heroUrl = new URL("../analytics_engine/public/little-alexandria-hero.png", import.meta.url);

test("starts at the Steam Deck Little Alexandria front door", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /S\.screen = "door";/);
  assert.match(html, /class="front-door__hero"/);
  assert.match(html, /San Francisco Japantown/);
  assert.match(html, /Read a little\. Play a lot\./);
  assert.match(html, /data-go="student" data-door-role>Student/);
  assert.match(html, /data-go="professor" data-door-role>Professor/);
  assert.match(html, /if \(S\.screen === "door"\)/);
  assert.match(html, /startOnboarding\(\)/);
});

test("ships the exact Steam Deck Little Alexandria artwork", async () => {
  const hero = await readFile(heroUrl);
  const digest = createHash("sha256").update(hero).digest("hex");

  assert.equal(digest, "768deff0ea96360645b191db40a12437341448ab95042d0d2264efa26a37dc80");
});

test("uses explicit verb-noun event contracts and rejects stale session responses", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /schemaVersion: "event\.v1"/);
  assert.match(html, /event: spec\.verb \+ " " \+ spec\.noun/);
  assert.match(html, /code: spec\.verb\.toLowerCase\(\) \+ "_" \+ spec\.noun/);
  assert.match(html, /role_selected:\s+\{ layer: "ui",\s+verb: "SELECT",\s+noun: "role"/);
  assert.match(html, /session_submit_requested:\s+\{ layer: "http",\s+verb: "POST",\s+noun: "reading_session"/);
  assert.match(html, /ev\.http = \{ method: spec\.verb, path: "\/api\/sessions" \}/);
  assert.match(html, /security: \{ classification: "pseudonymous", policy: "student_telemetry_v1" \}/);
  assert.equal((html.match(/if \(S\.runId !== submissionTraceId\) return;/g) ?? []).length, 2);
  const resetBody = html.match(/function reset\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(resetBody.indexOf("S.runId = nextTraceId") < resetBody.indexOf("loadPassage()"));
  assert.ok(resetBody.indexOf("EVENTS = []") < resetBody.indexOf("loadPassage()"));
  assert.match(html, /phase: type === "session_save_failed" && httpStatus === null \? "transport_error" : spec\.phase/);
  assert.match(html, /wordRef: "chunk_" \+ chunkId \+ ":token_"/);
  assert.doesNotMatch(html, /logEvent\("word_tapped", \{\s*word:/);
  assert.match(html, /errorCode: httpStatus \? "HTTP_" \+ httpStatus : "NETWORK_ERROR"/);
  assert.doesNotMatch(html, /logEvent\("session_save_failed", \{ error:/);
});
