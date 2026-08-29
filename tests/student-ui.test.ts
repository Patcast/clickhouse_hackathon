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
