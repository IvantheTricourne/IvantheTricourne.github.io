/**
 * What can this browser actually do?
 *
 * Gating is on capability, never on device class: WebGPU ships on iOS 26 and
 * iPadOS 26, so "mobile" does not imply "no local model", and some desktop
 * browsers still lack it depending on OS and driver. Screen size is used only
 * to decide how loudly to warn about a multi-gigabyte download, never to
 * decide whether the option exists.
 */

export async function detectWebGpu() {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return { supported: false, reason: "This browser does not expose WebGPU." };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: "WebGPU is present but no adapter was granted (often a blocklisted driver, or a headless/VM display).",
      };
    }
    const info = (await adapter.requestAdapterInfo?.()) ?? {};
    return {
      supported: true,
      vendor: info.vendor || "unknown",
      architecture: info.architecture || "",
      maxBufferMB: Math.round((adapter.limits?.maxBufferSize ?? 0) / 1e6),
    };
  } catch (cause) {
    return { supported: false, reason: `WebGPU adapter request failed: ${cause.message}` };
  }
}

/** Free space, so a 2.3 GB download can be refused before it starts. */
export async function estimateStorage() {
  try {
    const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    return { quotaMB: Math.round(quota / 1e6), usedMB: Math.round(usage / 1e6),
             freeMB: Math.round((quota - usage) / 1e6) };
  } catch {
    return null;
  }
}

/**
 * Best-effort only. navigator.connection is unavailable on Safari and can lie
 * elsewhere, so this raises the friction on a download, it never blocks one.
 */
export function downloadCaution() {
  const conn = navigator.connection ?? {};
  const smallScreen = typeof window !== "undefined"
    && window.matchMedia?.("(max-width: 820px)").matches;
  return {
    saveData: conn.saveData === true,
    slowNetwork: ["slow-2g", "2g", "3g"].includes(conn.effectiveType),
    smallScreen: Boolean(smallScreen),
  };
}
