import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { opencodeCandidates } from "./binaries.mjs";
import { config } from "./config.mjs";
import { extractJson } from "./jsonextract.mjs";
import { emit } from "./log.mjs";
import { recordRun } from "./state.mjs";

mkdirSync(config.runsDir, { recursive: true });

export class LlmJob {
  constructor({
    stage, scope, system, user, images = [], promptVersion = null, onDelta = null,
    agent = config.llmAgent, variant = config.modelVariant,
  }) {
    this.id = randomUUID();
    this.stage = stage;
    this.scope = scope;
    this.system = system;
    this.user = user;
    this.images = images;
    this.promptVersion = promptVersion;
    this.onDelta = onDelta;
    this.agent = agent;
    this.variant = variant;
    this.text = "";
    this.json = null;
    this.usage = { tokensIn: 0, tokensOut: 0 };
    this.sessionId = null;
    this.rawFile = null;
    this.exitCode = null;
    this.stderr = "";
  }
}

export class OpencodePool {
  constructor(threads = config.threads) {
    this.threads = Math.max(1, Math.min(config.maxThreads, Number(threads) || 1));
    this.active = new Map();
    this.queue = [];
    this.paused = false;
    this.nextRunId = 0;
  }

  setThreads(value) {
    const threads = Math.max(1, Math.min(config.maxThreads, Number(value) || 1));
    this.threads = threads;
    emit("threads", { threads });
    this.#pump();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    emit("pause", { paused: this.paused });
    if (!this.paused) this.#pump();
  }

  submit(job) {
    if (!(job instanceof LlmJob)) throw new TypeError("submit expects an LlmJob");
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      emit("queue", { queued: this.queue.length, active: this.active.size });
      this.#pump();
    });
  }

  snapshot() {
    return {
      threads: this.threads,
      paused: this.paused,
      queued: this.queue.length,
      active: [...this.active.values()].map((entry) => ({
        id: entry.job.id, stage: entry.job.stage, scope: entry.job.scope, sessionId: entry.job.sessionId,
      })),
    };
  }

  #pump() {
    while (!this.paused && this.active.size < this.threads && this.queue.length > 0) {
      const entry = this.queue.shift();
      this.active.set(entry.job.id, entry);
      this.#run(entry.job).then(entry.resolve, entry.reject).finally(() => {
        this.active.delete(entry.job.id);
        emit("queue", { queued: this.queue.length, active: this.active.size });
        this.#pump();
      });
    }
  }

  async #run(job) {
    if (!config.opencodeBin) {
      throw new Error([
        "OpenCode CLI not found. Set OPENCODE_BIN to an absolute path, for example:",
        "  OPENCODE_BIN=$(command -v opencode)",
        `Searched PATH and: ${opencodeCandidates().join(", ")}`,
      ].join("\n"));
    }
    const runId = `${Date.now()}-${this.nextRunId++}-${job.id.slice(0, 8)}`;
    const rawFile = join(config.runsDir, `${job.stage}-${runId}.jsonl`);
    job.rawFile = rawFile;
    for (const image of job.images) {
      if (!existsSync(image)) throw new Error(`Model image does not exist: ${image}`);
      if (statSync(image).size < 100) throw new Error(`Model image is empty or truncated: ${image}`);
    }
    const title = `factory-${job.stage}-${runId}`.slice(0, 120);
    const message = [
      `<system_prompt version="${job.promptVersion ?? "unspecified"}">`,
      job.system,
      "</system_prompt>",
      "",
      "<task>",
      job.user,
      "</task>",
    ].join("\n");
    // OpenCode/yargs requires the positional message before -f image flags.
    const args = ["run", "--pure", "-m", config.model, "--format", "json", "--title", title];
    if (job.agent) args.push("--agent", job.agent);
    if (job.variant) args.push("--variant", job.variant);
    args.push(message);
    for (const image of job.images) args.push("-f", image);

    emit("worker_start", { id: job.id, stage: job.stage, scope: job.scope, rawFile });
    const child = spawn(config.opencodeBin, args, {
      cwd: config.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let sawStepFinish = false;
    let spawnError = null;
    let settled = false;
    let startupTimer = null;

    const consumeLine = (raw) => {
      const line = String(raw).trim();
      if (!line) return;
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      if (Buffer.byteLength(line) > config.maxResponseBytes) {
        spawnError = new Error(`OpenCode emitted an oversized event exceeding ${config.maxResponseBytes} bytes`);
        child.kill("SIGKILL");
        return;
      }
      try {
        appendFileSync(rawFile, `${line}\n`);
      } catch (error) {
        spawnError = error;
        child.kill("SIGKILL");
        return;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        emit("worker_api", { id: job.id, stage: job.stage, scope: job.scope, eventType: "unparsed", raw: line });
        return;
      }
      if (event.sessionID && !job.sessionId) job.sessionId = event.sessionID;
      if (event.type === "text" && typeof event.part?.text === "string") {
        if (Buffer.byteLength(job.text) + Buffer.byteLength(event.part.text) > config.maxResponseBytes) {
          spawnError = new Error(`OpenCode response exceeded ${config.maxResponseBytes} bytes`);
          child.kill("SIGKILL");
          return;
        }
        job.text += event.part.text;
        try { job.onDelta?.(event.part.text, job); }
        catch (error) { emit("worker_callback_error", { id: job.id, stage: job.stage, error: error.message }); }
        emit("worker_text", {
          id: job.id,
          stage: job.stage,
          scope: job.scope,
          delta: event.part.text,
          eventType: event.type,
          sessionId: event.sessionID ?? job.sessionId,
        });
      } else {
        emit("worker_api", {
          id: job.id,
          stage: job.stage,
          scope: job.scope,
          eventType: event.type ?? event.part?.type ?? "event",
          sessionId: event.sessionID ?? job.sessionId,
          raw: line,
        });
      }
      if (event.type === "step_finish" && event.part?.tokens) {
        sawStepFinish = true;
        tokensIn += Number(event.part.tokens.input ?? 0);
        tokensOut += Number(event.part.tokens.output ?? 0) + Number(event.part.tokens.reasoning ?? 0);
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > config.maxResponseBytes) {
        spawnError = new Error(`OpenCode unterminated event exceeded ${config.maxResponseBytes} bytes`);
        child.kill("SIGKILL");
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      job.stderr = `${job.stderr}${text}`.slice(-8000);
      if (text.trim()) emit("worker_err", { id: job.id, stage: job.stage, err: text.trim().slice(0, 500) });
    });
    child.once("error", (error) => {
      spawnError = error;
    });

    startupTimer = setTimeout(() => {
      job.stderr = `${job.stderr}\nno OpenCode event after ${config.llmStartTimeoutMs}ms`.trim();
      spawnError = new Error(`OpenCode startup timeout after ${config.llmStartTimeoutMs}ms without an event`);
      child.kill("SIGKILL");
    }, Math.min(config.llmStartTimeoutMs, config.requestTimeoutMs));

    const timer = setTimeout(() => {
      job.stderr = `${job.stderr}\nrequest timeout after ${config.requestTimeoutMs}ms`.trim();
      spawnError = new Error(`OpenCode request timeout after ${config.requestTimeoutMs}ms`);
      child.kill("SIGKILL");
    }, config.requestTimeoutMs);

    return await new Promise((resolve, reject) => {
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (startupTimer) clearTimeout(startupTimer);
        if (buffer.trim()) consumeLine(buffer);
        job.exitCode = code;
        job.json = extractJson(job.text);
        job.usage = { tokensIn, tokensOut };
        const transportOk = !spawnError && code === 0 && sawStepFinish && job.text.trim().length > 0;
        let failureMessage = transportOk
          ? null
          : spawnError?.message ?? `OpenCode job failed (exit=${code}, signal=${signal ?? "none"}): ${job.stderr.slice(-500)}`;
        try {
          job.runDbId = recordRun({
            stage: job.stage,
            scope: typeof job.scope === "string" ? job.scope : JSON.stringify(job.scope),
            sessionId: job.sessionId,
            model: config.model,
            tokensIn,
            tokensOut,
            ok: transportOk,
            rawFile,
            error: failureMessage,
          });
        } catch (error) {
          spawnError = new Error(`Unable to persist OpenCode run: ${error.message}`, { cause: error });
          failureMessage = spawnError.message;
        }
        const ok = transportOk && !spawnError;
        emit("worker_done", {
          id: job.id, stage: job.stage, scope: job.scope, ok, code, signal, tokensIn, tokensOut,
          error: ok ? null : failureMessage,
        });
        if (ok) resolve(job);
        else {
          const error = new Error(failureMessage);
          error.job = job;
          reject(error);
        }
      });
    });
  }
}
