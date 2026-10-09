/**
 * Auto reasoning-effort declaration for DeepSeek Harness.
 *
 * Ensures every model explicitly listed under an `llm-pi-ai` provider route
 * carries a `reasoningEfforts` declaration, so the model picker can offer
 * thinking-depth selection (off / low / high / max) for every configured
 * model. Models that already declare their efforts — including an explicit
 * `reasoningEfforts: false` (deliberately non-reasoning) — are left alone.
 *
 * The declaration is written through the profile Config editor, so it lands
 * in the profile's cordis.patch.yml and hot-reloads the llm-pi-ai adapter
 * without a restart. The plugin re-checks whenever the profile configuration
 * changes (Models-page edits, manual patch edits, plugin installs), so models
 * added later are covered automatically.
 *
 * Configuration edits and profile reloads serialize on one HMR transaction,
 * and change events fire while that transaction is still open; an edit
 * attempted there fails with "HMR transactions cannot be nested". The ensure
 * pass therefore retries with backoff until the transaction has drained.
 *
 * @module dsh-auto-reasoning
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/** Cordis plugin name. */
export const name = "auto-reasoning";

/** The profile configuration editor is the plugin's one required dependency. */
export const inject = ["configEditor"];

/** The profile entry whose config declares pi-ai provider routes. */
const TARGET_ENTRY_ID = "llm-pi-ai";

/** The default reasoning-effort declaration for models without one. */
const DEFAULT_EFFORTS = { off: null, low: "low", high: "high", max: "max" };

/** Retry backoff for edits blocked by a live HMR transaction, in milliseconds. */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/** Debug log beside this module: activation and every ensure outcome. */
const DEBUG_LOG = join(dirname(fileURLToPath(import.meta.url)), "debug.log");

/** Append one timestamped line to the debug log (best effort). */
function log(message) {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Diagnostics must never break the plugin.
  }
}

/** Sleep for the given milliseconds. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Add the default declaration to every explicitly listed model that carries
 * no `reasoningEfforts` field. Mutates the passed config in place.
 * @param config - one raw llm-pi-ai entry config.
 * @returns the number of models that gained a declaration.
 */
function declareEfforts(config) {
  let touched = 0;
  const providers = config?.providers;
  if (providers === null || typeof providers !== "object") return touched;
  for (const profile of Object.values(providers)) {
    if (profile === null || typeof profile !== "object") continue;
    if (!Array.isArray(profile.models)) continue;
    for (const model of profile.models) {
      if (model === null || typeof model !== "object") continue;
      // Respect every existing declaration, including `false`
      // (a deliberately non-reasoning model).
      if (model.reasoningEfforts !== undefined) continue;
      model.reasoningEfforts = { ...DEFAULT_EFFORTS };
      touched += 1;
    }
  }
  return touched;
}

/** Whether an error is the HMR nesting refusal (retryable) or entry staleness. */
function isRetryable(error) {
  const text = String(error);
  return text.includes("HMR transactions cannot be nested")
    || text.includes("Configuration entry is no longer available")
    || text.includes("Configuration entry changed during reload");
}

/**
 * One idempotent pass: find the llm-pi-ai entry, and when any of its
 * explicitly listed models lacks a reasoningEfforts declaration, write the
 * completed config back through the profile Config editor, retrying while a
 * profile reload transaction holds the write lock.
 */
export function apply(ctx) {
  log("apply: activated");
  /** Re-entrancy guard: one ensure pass at a time. */
  let running = false;

  async function ensure() {
    if (running) {
      log("ensure: skipped (already running)");
      return;
    }
    running = true;
    try {
      const editor = ctx.configEditor;
      if (editor === undefined) {
        log("ensure: configEditor unavailable");
        return;
      }
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        // Re-lookup on every attempt: a blocking reload may have replaced
        // the entry object, and the config may have changed underneath.
        const entry = editor.entries().find((row) => row.options.id === TARGET_ENTRY_ID);
        if (entry === undefined || entry.fiber === undefined) {
          log(`ensure: entry "${TARGET_ENTRY_ID}" not found among ${editor.entries().length} addressable entries`);
          return;
        }
        const preview = declareEfforts(structuredClone(entry.options.config ?? {}));
        if (preview === 0) {
          log("ensure: nothing to declare");
          return;
        }
        log(`ensure: ${preview} model(s) lack reasoningEfforts; editing config (attempt ${attempt + 1})`);
        try {
          await editor.edit(entry, (raw) => {
            const next = structuredClone(raw);
            return declareEfforts(next) > 0 ? next : raw;
          });
          log("ensure: edit committed");
          ctx.logger.info("auto-reasoning: declared reasoning efforts for models lacking them");
          return;
        } catch (error) {
          if (attempt < RETRY_DELAYS_MS.length && isRetryable(error)) {
            log(`ensure: retryable failure (${String(error)}); retrying in ${RETRY_DELAYS_MS[attempt]}ms`);
            await delay(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      log(`ensure: error ${String(error)}`);
      ctx.logger.warn("auto-reasoning: %s", String(error));
    } finally {
      running = false;
    }
  }

  /** Schedule one ensure pass slightly deferred, so a firing HMR transaction
   *  can drain first; escape any inherited HMR transaction context so the
   *  eventual edit serializes with reloads instead of falsely nesting. */
  const schedule = (reason) => {
    log(`schedule: ${reason}`);
    const run = () => setTimeout(() => void ensure(), 250);
    const hmr = ctx.get("hmr");
    if (hmr !== undefined && typeof hmr.executing?.exit === "function") {
      hmr.executing.exit(run);
    } else {
      run();
    }
  };

  // First pass once the whole loader tree has settled (llm-pi-ai included).
  ctx.root.loader.await().then(
    () => schedule("loader settled"),
    (error) => log(`loader await rejected: ${String(error)}`),
  );

  // Re-check whenever the llm-pi-ai entry's configuration changes
  // (Models-page edits land there through the settings write path).
  ctx.on("settings/document-updated", (ns) => {
    if (ns === TARGET_ENTRY_ID) schedule("settings/document-updated");
  }, { global: true });

  // Re-check after every profile configuration reload: manual patch edits,
  // Config-editor writes, and plugin installs all reconcile through here.
  ctx.on("app-boot/config-reload", () => schedule("app-boot/config-reload"), { global: true });
}
