// Dev-only WebXR emulation for testing the AR/VR modes without a headset.
// Opt-in via a URL flag (e.g. http://localhost:8080/?emulate-xr=1) so it
// never runs on the real Pico deployment unless someone explicitly asks
// for it. Uses IWER (github.com/meta-quest/immersive-web-emulation-runtime),
// the same emulation engine behind the "Immersive Web Emulator" browser
// extension, loaded here as a plain CDN script so no extension install or
// build step is needed — only a normal desktop Chrome/Edge tab.
const IWER_CDN_SRC = "https://unpkg.com/iwer@2.1.1/build/iwer.min.js";

function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

export async function installXrEmulatorIfRequested() {
  if (!new URLSearchParams(window.location.search).has("emulate-xr")) return;

  if (!window.isSecureContext) {
    console.warn("Skipped the WebXR emulator: this page is not a secure context (use localhost or HTTPS).");
    return;
  }

  try {
    await loadScriptOnce(IWER_CDN_SRC);
    const { XRDevice, metaQuest3 } = window.IWER;
    new XRDevice(metaQuest3).installRuntime();
    console.info("WebXR emulator installed (IWER, Meta Quest 3 profile) — AR/VR modes can now be tested without a headset. Note: the emulator does not support the WebXR DOM Overlay feature, so AR passthrough will still report unsupported here; use it to test VR cinema mode.");
  } catch (error) {
    console.warn("Could not install the WebXR emulator:", error);
  }
}
