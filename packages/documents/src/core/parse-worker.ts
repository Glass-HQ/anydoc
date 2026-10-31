/// <reference lib="webworker" />
import { runCoreTask } from "./core-runtime.js";
import type { CoreRequest, CoreResponse } from "./parse.js";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async ({ data }: MessageEvent<CoreRequest>) => {
  let response: CoreResponse;
  try {
    response = { id: data.id, ok: true, value: await runCoreTask(data.task, data.bytes, data.format) };
  } catch (cause) {
    const error = cause as { message?: string; code?: string; pages?: number[] };
    response = { id: data.id, ok: false, error: { message: error.message ?? String(cause), ...(error.code ? { code: error.code } : {}), ...(error.pages ? { pages: error.pages } : {}) } };
  }
  self.postMessage(response);
};
