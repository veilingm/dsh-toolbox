/**
 * Host plugin for the default multimodal model configurator.
 *
 * Persists the user's chosen default provider/model for multimodal (image and
 * other non-text) tasks under `$DSH_HOME/default-multimodal-model.json`, and
 * serves it over a small HTTP API:
 *
 *   GET  /api/default-multimodal-model            — current selection + defaults
 *   PUT  /api/default-multimodal-model            — replace the selection
 *   GET  /api/default-multimodal-model/models     — discoverable multimodal
 *                                                   models (scanned from the
 *                                                   profile cordis.patch.yml)
 *
 * @module dsh-default-multimodal-model
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Cordis plugin name. */
export const name = "default-multimodal-model";

/** The plugin only needs the web server seam (injected lazily in apply). */
export const inject = [];

/** Resolve the DSH home directory. */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Path of the persisted selection document. */
function configPath() {
  return join(dshHome(), "default-multimodal-model.json");
}

/** Default document written when none exists yet. */
function defaultDocument() {
  return {
    version: 1,
    provider: "",
    model: "",
    updatedAt: null,
  };
}

/**
 * Validate and normalize an incoming selection body into a storable document.
 * Returns { ok: true, value } or { ok: false, error }.
 */
function normalize(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "请求体必须是 JSON 对象" };
  }
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (provider === "" || model === "") {
    return { ok: false, error: "provider 和 model 均不能为空" };
  }
  return {
    ok: true,
    value: {
      version: 1,
      provider,
      model,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Load the persisted document (falling back to the default when absent). */
async function loadDocument() {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return defaultDocument();
    return {
      version: Number.isInteger(parsed.version) ? parsed.version : 1,
      provider: typeof parsed.provider === "string" ? parsed.provider : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return defaultDocument();
  }
}

/** Persist a document (atomic enough for this use case). */
async function saveDocument(doc) {
  await mkdir(dshHome(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(doc, null, 2) + "\n", "utf8");
  return doc;
}

/**
 * Resolve the candidate profile directories in preference order. The DSH
 * runtime does not always export `DSH_PROFILE_DIR` to plugin processes, so we
 * derive it from `DSH_HOME` (always set) and `DSH_PROFILE` as fallbacks.
 */
function profileDirs() {
  const dirs = [];
  const home = process.env.DSH_HOME;
  const profile = process.env.DSH_PROFILE || "desktop";
  const explicit = process.env.DSH_PROFILE_DIR;
  const osHome = join(homedir(), ".dsh");

  if (explicit) dirs.push(explicit);
  if (home) {
    dirs.push(join(home, "profiles", profile));
    dirs.push(join(home, "profiles", "desktop"));
  }
  dirs.push(join(osHome, "profiles", "desktop"));

  // De-duplicate while preserving order.
  return [...new Set(dirs)];
}

async function discoverModels() {
  const files = [];
  for (const profileDir of profileDirs()) {
    files.push(join(profileDir, "cordis.patch.yml"));
    files.push(join(profileDir, "cordis.yml"));
  }
  // Best effort only — any unreadable file is skipped silently.
  const results = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const found = extractProviders(text);
    if (found.length > 0) results.push(...found);
  }
  return results;
}

/**
 * Narrow line-based parser for the providers map produced by
 * `@deepseek-ai/dsh-llm-pi-ai`. It recognizes this shape:
 *
 *   providers:
 *     <id>:
 *       displayName: <name>
 *       models:
 *         - id: <model>
 *           input:
 *             - text
 *             - image
 *
 * Each provider is only emitted when it has at least one model with `image`.
 */
function extractProviders(text) {
  const lines = text.split(/\r?\n/);
  const providers = [];
  let providersIndent = null; // indent of the `providers:` key
  let providerIndent = null; // indent of a provider id key
  let modelsIndent = null; // indent of the `models:` key under a provider
  let currentProvider = null;
  let currentModel = null;

  const ind = (line) => {
    const m = /^(\s*)\S/.exec(line);
    return m ? m[1].length : -1;
  };
  const keyOf = (line) => {
    const m = /^\s*([A-Za-z0-9_\-@/.]+)\s*:/.exec(line);
    return m ? m[1] : null;
  };
  const listScalar = (line) => {
    // `- text`, `- id: foo`, `- name: foo`
    const m = /^\s*-\s+(?:([A-Za-z0-9_\-@/.]+)\s*:\s*)?(.*)$/.exec(line);
    if (!m) return null;
    return { key: m[1] ?? null, value: m[2].trim() };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const depth = ind(line);
    const key = keyOf(line);
    const isListLine = trimmed.startsWith("- ");

    if (!isListLine && key === "providers") {
      providersIndent = depth;
      providerIndent = null;
      modelsIndent = null;
      currentProvider = null;
      currentModel = null;
      continue;
    }

    if (providersIndent !== null) {
      // Provider id: a scalar key one level deeper than providers, that opens a
      // nested map (its value is empty because it is followed by nested keys).
      if (
        !isListLine &&
        depth === providersIndent + 2 &&
        key !== null &&
        trimmed.endsWith(":")
      ) {
        // Commit the current model into the previous provider before switching.
        if (currentModel && currentProvider) {
          currentProvider.models.push(currentModel);
          currentModel = null;
        }
        // Commit previous provider.
        if (currentProvider && currentProvider.models.length > 0) {
          providers.push(currentProvider);
        }
        providerIndent = depth;
        modelsIndent = null;
        currentProvider = { provider: key, displayName: key, models: [] };
        currentModel = null;
        continue;
      }

      // displayName under a provider.
      if (
        !isListLine &&
        providerIndent !== null &&
        depth === providerIndent + 2 &&
        key === "displayName"
      ) {
        const m = /^\s*displayName\s*:\s*(.*)$/.exec(line);
        if (m && currentProvider) currentProvider.displayName = m[1].trim();
        continue;
      }

      // models: under a provider.
      if (
        !isListLine &&
        providerIndent !== null &&
        depth === providerIndent + 2 &&
        key === "models" &&
        trimmed.endsWith(":")
      ) {
        modelsIndent = depth;
        currentModel = null;
        continue;
      }

      // A model list item: `- id: x` under models.
      if (isListLine && modelsIndent !== null && depth === modelsIndent + 2) {
        const item = listScalar(line);
        if (item && item.key === "id") {
          if (currentModel && currentProvider) {
            currentProvider.models.push(currentModel);
          }
          currentModel = { id: item.value, name: item.value, input: false };
        } else if (item && item.key === "name" && currentModel) {
          currentModel.name = item.value;
        }
        continue;
      }

      // Inside a model: the `- image` list item under `input:`.
      if (
        isListLine &&
        modelsIndent !== null &&
        currentModel !== null &&
        depth === modelsIndent + 6
      ) {
        const item = listScalar(line);
        if (item && item.value === "image") {
          currentModel.input = true;
        }
        continue;
      }

      // Out of the providers block.
      if (!isListLine && depth <= providersIndent) {
        if (currentModel && currentProvider) {
          currentProvider.models.push(currentModel);
        }
        if (currentProvider && currentProvider.models.length > 0) {
          providers.push(currentProvider);
        }
        providersIndent = null;
        providerIndent = null;
        modelsIndent = null;
        currentProvider = null;
        currentModel = null;
        continue;
      }
    }
  }

  // Flush trailing model/provider.
  if (currentModel && currentProvider) currentProvider.models.push(currentModel);
  if (currentProvider && currentProvider.models.length > 0) {
    providers.push(currentProvider);
  }

  // Filter to multimodal-capable models only.
  return providers
    .map((p) => ({
      provider: p.provider,
      displayName: p.displayName,
      models: p.models
        .filter((m) => m.input === true)
        .map((m) => ({ id: m.id, name: m.name ?? m.id })),
    }))
    .filter((p) => p.models.length > 0);
}

/** Send one JSON response. */
function sendJson(res, code, value) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(JSON.stringify(value));
}

/** Read one request's full body as text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Cordis entry point. */
export function apply(ctx) {
  // Probe which cordis services are available — useful for diagnostics.
  let serviceKeys = [];
  try {
    serviceKeys = Object.keys(ctx).filter(
      (k) => typeof k === "string" && !k.startsWith("__"),
    );
  } catch {
    /* ignore */
  }

  ctx.inject(["webServer"], (webCtx) => {
    // ── Models discovery endpoint (with diagnostic debug) ──
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "exact",
          path: "/api/default-multimodal-model/models",
          handler: async (_req, res) => {
            try {
              const providers = await discoverModels();
              sendJson(res, 200, {
                providers,
                debug: {
                  DSH_HOME: process.env.DSH_HOME ?? null,
                  DSH_PROFILE: process.env.DSH_PROFILE ?? null,
                  DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR ?? null,
                  homedir: homedir(),
                  profileDirs: profileDirs(),
                  ctxServiceKeys: serviceKeys,
                },
              });
            } catch (error) {
              sendJson(res, 500, { error: String(error) });
            }
          },
        }),
      "default-multimodal-model: models api",
    );

    // ── Config read/write endpoint ──
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "exact",
          path: "/api/default-multimodal-model",
          handler: async (req, res) => {
            try {
              if (req.method === "GET" || req.method === "HEAD") {
                sendJson(res, 200, { config: await loadDocument() });
                return;
              }
              if (req.method !== "PUT") {
                res.writeHead(405, { allow: "GET, PUT" });
                res.end();
                return;
              }
              let body;
              try {
                body = JSON.parse(await readBody(req));
              } catch {
                sendJson(res, 400, { error: "请求体不是合法 JSON" });
                return;
              }
              const normalized = normalize(body);
              if (!normalized.ok) {
                sendJson(res, 400, { error: normalized.error });
                return;
              }
              const saved = await saveDocument(normalized.value);
              sendJson(res, 200, { config: saved });
            } catch (error) {
              sendJson(res, 500, { error: String(error) });
            }
          },
        }),
      "default-multimodal-model: config api",
    );
  });
}
