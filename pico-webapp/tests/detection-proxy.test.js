import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";




test("HUD default channel follows the page host and secure transport", () => {
  for (const [protocol, scheme] of [["http:", "ws:"], ["https:", "wss:"]]) {
    const window = { location: { protocol, host: "192.168.0.2:8443" } };
    runInNewContext(readFileSync(new URL("../config.js", import.meta.url), "utf8"), { window });
    assert.equal(window.HUD_CONFIG.n8nDetectionWebSocketUrl, `${scheme}//192.168.0.2:8443/detections`);
  }
});
