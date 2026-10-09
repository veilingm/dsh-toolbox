/**
 * Browser half of dsh-default-multimodal-model: a Cordis client plugin that
 * registers the 默认多模态模型 section in the Settings panel. The user picks a
 * provider and a multimodal-capable model (image input), with a free-text
 * override for providers/models the scanner did not discover.
 *
 * NOTE: the DSH client module loader serves exactly ONE entry file per plugin
 * (client/index.js), so all code lives here in clearly delimited regions.
 *
 * @module dsh-default-multimodal-model/client
 */
window.__ModuleLoader__.load({
	id: "dsh-default-multimodal-model",
	factory(require) {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { useState, useEffect, useCallback, useMemo } = React;
		const h = React.createElement;

		//#region styles
		const CSS_TAG = "dsh-default-multimodal-model/section.css";
		const CSS = [
			".dmm-section{flex-direction:column;width:100%;display:flex;gap:14px;color:var(--dsw-alias-label-primary);padding-bottom:8px}",
			".dmm-panel{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:15px 17px}",
			".dmm-panel h3{margin:0 0 4px;font-size:14px;font-weight:600}",
			".dmm-panel .dmm-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin:0 0 13px}",
			".dmm-field{display:flex;flex-direction:column;gap:6px;margin-bottom:13px}",
			".dmm-field label{font-size:13px;color:var(--dsw-alias-label-secondary)}",
			".dmm-input{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:7px 11px;width:100%;box-sizing:border-box}",
			".dmm-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".dmm-select{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:7px 11px;width:100%;box-sizing:border-box;cursor:pointer}",
			".dmm-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".dmm-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
			".dmm-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:1.5;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary)}",
			".dmm-badge.saved{background:rgba(34,197,94,.14);color:#22c55e;border-color:transparent}",
			".dmm-current{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}",
			".dmm-current code{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:1px 7px}",
			".dmm-btn{font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:6px 14px}",
			".dmm-btn:hover{border-color:var(--dsw-alias-brand-primary)}",
			".dmm-btn.primary{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}",
			".dmm-btn.primary:disabled{opacity:.55;cursor:default}",
			".dmm-actions{display:flex;gap:8px;align-items:center;margin-top:3px}",
			".dmm-err{color:var(--dsw-alias-label-error);font-size:12px;margin:0}",
			".dmm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.7;margin:8px 0 0}",
			".dmm-models{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}",
			".dmm-chip{font:inherit;font-size:12px;line-height:1.6;cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;padding:3px 12px;color:var(--dsw-alias-label-secondary)}",
			".dmm-chip:hover{border-color:var(--dsw-alias-brand-primary)}",
			".dmm-chip[data-active=true]{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}",
			".dmm-loading{color:var(--dsw-alias-label-tertiary);text-align:center;padding:22px 0;font-size:13px}",
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-default-multimodal-model";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region data helpers
		const EMPTY_PROVIDERS = [];

		async function fetchJson(url, options) {
			const resp = await fetch(url, options);
			const text = await resp.text();
			let payload = null;
			try {
				payload = text === "" ? null : JSON.parse(text);
			} catch {
				payload = null;
			}
			if (!resp.ok) {
				const msg = payload && payload.error ? payload.error : "HTTP " + resp.status;
				throw new Error(msg);
			}
			return payload;
		}

		/** Sort providers alphabetically with the configured one first. */
		function sortProviders(providers, selectedProvider) {
			return [...providers].sort((a, b) => {
				if (selectedProvider !== "") {
					if (a.provider === selectedProvider) return -1;
					if (b.provider === selectedProvider) return 1;
				}
				return a.provider.localeCompare(b.provider);
			});
		}
		//#endregion

		//#region section component
		function MultimodalSection() {
			const [config, setConfig] = useState(null); // persisted selection
			const [providers, setProviders] = useState(EMPTY_PROVIDERS);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState("");

			// Draft form state.
			const [provider, setProvider] = useState("");
			const [model, setModel] = useState("");
			const [saving, setSaving] = useState(false);
			const [savedFlash, setSavedFlash] = useState(false);

			const load = useCallback(async () => {
				setLoading(true);
				setError("");
				try {
					const [cfgPayload, modelsPayload] = await Promise.all([
						fetchJson("/api/default-multimodal-model"),
						fetchJson("/api/default-multimodal-model/models"),
					]);
					const cfg = cfgPayload && cfgPayload.config ? cfgPayload.config : { provider: "", model: "" };
					setConfig(cfg);
					setProvider(cfg.provider || "");
					setModel(cfg.model || "");
					const list = modelsPayload && Array.isArray(modelsPayload.providers) ? modelsPayload.providers : [];
					setProviders(list);
				} catch (e) {
					setError("加载失败：" + e.message);
				} finally {
					setLoading(false);
				}
			}, []);

			useEffect(() => {
				load();
			}, [load]);

			const currentProvider = useMemo(() => {
				return (providers.find((p) => p.provider === provider)) ?? null;
			}, [providers, provider]);

			const availableModels = useMemo(() => {
				if (!currentProvider) return [];
				return currentProvider.models;
			}, [currentProvider]);

			const onProviderChange = (e) => {
				const next = e.target.value;
				setProvider(next);
				// Auto-select the first model of the newly chosen provider when the
				// previous model does not belong to it.
				const p = providers.find((x) => x.provider === next);
				if (p && p.models.length > 0) {
					setModel(p.models[0].id);
				} else {
					setModel("");
				}
			};

			const onModelChange = (e) => setModel(e.target.value);

			const selectPreset = (p) => {
				setProvider(p.provider);
				setModel(p.models && p.models.length > 0 ? p.models[0].id : "");
			};

			const save = useCallback(async () => {
				if (provider.trim() === "" || model.trim() === "") {
					setError("请选择或填写 provider 和 model");
					return;
				}
				setSaving(true);
				setError("");
				setSavedFlash(false);
				try {
					const payload = await fetchJson("/api/default-multimodal-model", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ provider: provider.trim(), model: model.trim() }),
					});
					setConfig(payload.config);
					setSavedFlash(true);
					setTimeout(() => setSavedFlash(false), 2200);
				} catch (e) {
					setError("保存失败：" + e.message);
				} finally {
					setSaving(false);
				}
			}, [provider, model]);

			if (loading) {
				return h("div", { className: "dmm-section" },
					h("div", { className: "dmm-loading" }, "加载中…"));
			}

			const providerOptions = sortProviders(providers, provider).map((p) =>
				h("option", { key: p.provider, value: p.provider },
					p.displayName && p.displayName !== p.provider
						? p.displayName + "（" + p.provider + "）"
						: p.provider));

			const modelOptions = availableModels.map((m) =>
				h("option", { key: m.id, value: m.id },
					m.name && m.name !== m.id ? m.name + "（" + m.id + "）" : m.id));

			// Keep the current free-text model available even when the scanner
			// did not discover it (so the dropdown does not drop the selection).
			const modelIsListed = availableModels.some((m) => m.id === model);
			const modelOptionsWithCurrent =
				model !== "" && !modelIsListed
					? [h("option", { key: "__current", value: model }, model)].concat(modelOptions)
					: modelOptions;

			const saved = config && config.provider === provider && config.model === model;

			return h("div", { className: "dmm-section" }, [
				// Current selection summary
				h("div", { key: "current", className: "dmm-panel" }, [
					h("h3", { key: "t" }, "当前默认多模态模型"),
					config && config.provider && config.model
						? h("div", { key: "row", className: "dmm-current" }, [
							h("code", { key: "prov" }, config.provider),
							h("span", { key: "sep" }, "/"),
							h("code", { key: "model" }, config.model),
							savedFlash
								? h("span", { key: "ok", className: "dmm-badge saved" }, "已保存")
								: null,
							config.updatedAt
								? h("span", { key: "at", className: "dmm-badge" },
									"更新于 " + new Date(config.updatedAt).toLocaleString("zh-CN"))
								: null,
						])
						: h("div", { key: "empty", className: "dmm-hint" },
							"尚未设置默认多模态模型。"),
				]),

				// Provider & model pickers
				h("div", { key: "form", className: "dmm-panel" }, [
					h("h3", { key: "t" }, "选择默认多模态模型"),
					h("p", { key: "sub", className: "dmm-sub" },
						"用于图片识别等需要视觉理解的任务。仅列出声明了图像输入能力（image input）的模型。"),
					h("div", { key: "grid", className: "dmm-grid" }, [
						h("div", { key: "pf", className: "dmm-field" }, [
							h("label", { key: "l", htmlFor: "dmm-provider" }, "Provider（供应商）"),
							h("select", {
								key: "s", id: "dmm-provider", className: "dmm-select",
								value: provider, onChange: onProviderChange,
							}, [
								h("option", { key: "__none", value: "" }, provider ? provider : "— 请选择 —"),
								...providerOptions,
							]),
						]),
						h("div", { key: "mf", className: "dmm-field" }, [
							h("label", { key: "l", htmlFor: "dmm-model" }, "Model（模型）"),
							h("select", {
								key: "s", id: "dmm-model", className: "dmm-select",
								value: model, onChange: onModelChange,
							}, [
								h("option", { key: "__none", value: "" }, model ? model : "— 请选择 —"),
								...modelOptionsWithCurrent,
							]),
						]),
					]),
					h("div", { key: "actions", className: "dmm-actions" }, [
						h("button", {
							key: "save", className: "dmm-btn primary",
							disabled: saving || saved || provider.trim() === "" || model.trim() === "",
							onClick: save,
						}, saving ? "保存中…" : saved ? "已保存" : "保存"),
						h("button", { key: "reset", className: "dmm-btn", onClick: load }, "重新加载"),
					]),
					error ? h("p", { key: "err", className: "dmm-err" }, error) : null,
					h("p", { key: "hint", className: "dmm-hint" },
						"选择保存在 $DSH_HOME/default-multimodal-model.json，重启后仍生效。未扫描到的 provider/model 可直接在下拉框中手动输入或通过该 JSON 文件修改。"),
				]),

				// Discovered multimodal providers quick pick
				providers.length > 0
					? h("div", { key: "list", className: "dmm-panel" }, [
						h("h3", { key: "t" }, "已发现的多模态供应商"),
						h("div", { key: "provs", className: "dmm-models" },
							providers.map((p) =>
								h("button", {
									key: p.provider,
									className: "dmm-chip",
									"data-active": provider === p.provider,
									onClick: () => selectPreset(p),
									title: p.models.map((m) => m.id).join("、"),
								}, p.displayName + "（" + p.models.length + " 个多模态模型）"))),
					])
					: null,
			]);
		}
		//#endregion

		//#region plugin face
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "default-multimodal-model",
				order: 18,
				label: () => "默认多模态模型",
			}, MultimodalSection));
		}

		exports.MultimodalSection = MultimodalSection;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
