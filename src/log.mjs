import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(type, data) {
  try {
    bus.emit("event", { type, data, ts: Date.now() });
  } catch (error) {
    // Rendering and model workers must not die because an optional dashboard
    // observer failed. Keep this dependency-free so logging cannot recurse.
    try { process.stderr.write(`[event-listener-error] ${String(error?.message ?? error).slice(0, 500)}\n`); } catch {}
  }
}

export function onEvent(fn) {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
