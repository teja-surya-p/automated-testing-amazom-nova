import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFullDeviceMatrix,
  QUICK_DEVICE_PROFILES,
  resolveUiuxDeviceProfiles
} from "../deviceMatrix.js";

test("buildFullDeviceMatrix returns deterministic matrix with >= 2000 profiles", () => {
  const matrixA = buildFullDeviceMatrix();
  const matrixB = buildFullDeviceMatrix();

  assert.equal(matrixA.length >= 2000, true);
  assert.equal(matrixA.length, matrixB.length);
  assert.deepEqual(matrixA.slice(0, 25), matrixB.slice(0, 25));
});

test("resolveUiuxDeviceProfiles in full-cap mode returns deterministic cap", () => {
  const profiles = resolveUiuxDeviceProfiles({
    testMode: "uiux",
    uiux: {
      devices: {
        mode: "full",
        selection: "cap",
        maxDevices: 50
      }
    }
  });

  assert.equal(profiles.length, 50);
  const profilesAgain = resolveUiuxDeviceProfiles({
    testMode: "uiux",
    uiux: {
      devices: {
        mode: "full",
        selection: "cap",
        maxDevices: 50
      }
    }
  });
  assert.deepEqual(
    profiles.map((entry) => entry.id),
    profilesAgain.map((entry) => entry.id)
  );
});

test("resolveUiuxDeviceProfiles in full-all mode returns full matrix", () => {
  const full = resolveUiuxDeviceProfiles({
    testMode: "uiux",
    uiux: {
      devices: {
        mode: "full",
        selection: "all",
        maxDevices: 0
      }
    }
  });

  assert.equal(full.length >= 2000, true);
});

test("allowlist and blocklist filtering works by id and label substring", () => {
  const quickId = QUICK_DEVICE_PROFILES[0].id;
  const filtered = resolveUiuxDeviceProfiles({
    testMode: "uiux",
    uiux: {
      devices: {
        mode: "full",
        selection: "all",
        maxDevices: 0,
        allowlist: ["iphone 13 pro", "desktop 1080p"],
        blocklist: ["desktop 1080p"]
      }
    }
  });

  assert.equal(filtered.some((entry) => /iphone 13 pro/i.test(entry.label)), true);
  assert.equal(filtered.some((entry) => /desktop 1080p/i.test(entry.label)), false);

  const quickFilteredById = resolveUiuxDeviceProfiles({
    testMode: "uiux",
    uiux: {
      devices: {
        mode: "quick",
        selection: "cap",
        maxDevices: 3,
        allowlist: [quickId]
      }
    }
  });

  assert.equal(quickFilteredById.length, 1);
  assert.equal(quickFilteredById[0].id, quickId);
});
