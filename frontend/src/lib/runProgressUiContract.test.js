import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readRunProgressSource() {
  const sourceUrl = new URL("../components/RunProgress.jsx", import.meta.url);
  return readFileSync(sourceUrl, "utf8");
}

test("Test Case Progress component keeps progress + logs UI and no artifact visibility", () => {
  const source = readRunProgressSource();

  assert.match(source, /Test Case Progress/);
  assert.match(source, /\bLogs\b/);
  assert.match(source, /\bCurrent\b/);
  assert.match(source, /\bNext\b/);

  assert.equal(/\bartifact\b/i.test(source), false);
  assert.equal(/\bartifacts\b/i.test(source), false);
  assert.equal(/ArtifactsList/.test(source), false);
  assert.equal(/thumbnail/i.test(source), false);
});

test("Run console does not pass artifact visibility props into Test Case Progress", () => {
  const runConsoleUrl = new URL("../pages/RunConsole.jsx", import.meta.url);
  const source = readFileSync(runConsoleUrl, "utf8");

  const runProgressInvocation = source.match(/<RunProgress\s+[^>]*>/g)?.join(" ") ?? "";
  assert.ok(runProgressInvocation.length > 0);
  assert.match(runProgressInvocation, /stats=/);
  assert.equal(/artifact/i.test(runProgressInvocation), false);
});
