/**
 * WebLLM engine host. Inference runs here so a multi-second prefill cannot
 * freeze the page; the main thread only ever sees postMessage traffic.
 */
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm@0.2.84";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
