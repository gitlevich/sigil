import { useState, useEffect } from "react";
import { useAppState, useAppDispatch, ThemePreference } from "../../state/AppContext";
import { Settings, AiProvider, Keybindings, KEYBINDING_LABELS, DEFAULT_KEYBINDINGS, toDisplayShortcut, api } from "../../tauri";
import styles from "./SettingsDialog.module.css";
import { DEFAULT_PARTNER_PROMPT as DEFAULT_SYSTEM_PROMPT } from "../../generated/partnerPrompt";

function generateId() {
  return `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SettingsDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [local, setLocal] = useState<Settings>(state.settings);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(state.themePreference);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "shortcuts">("general");

  useEffect(() => {
    setLocal(state.settings);
    setLocalTheme(state.themePreference);
  }, [state.settings, state.themePreference]);

  useEffect(() => {
    if (!editing || !editing.api_key.trim()) {
      setModels([]);
      setModelsError(null);
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    api.listModels(editing.provider, editing.api_key, showAllModels)
      .then((ms) => { setModels(ms); setModelsError(null); })
      .catch((err) => {
        const msg = typeof err === "string" ? err : (err?.message ?? String(err));
        console.error("[listModels] failed:", msg);
        setModels([]);
        setModelsError(msg);
      })
      .finally(() => setModelsLoading(false));
  }, [editing?.provider, editing?.api_key, showAllModels]);

  if (!state.settingsOpen) return null;

  const handleSave = () => {
    dispatch({ type: "SET_SETTINGS", settings: local });
    dispatch({ type: "SET_THEME", theme: localTheme });
    dispatch({ type: "SET_SETTINGS_OPEN", open: false });
  };

  const providers = local.ai_providers || [];

  /// Most recently saved api_key for `provider`, excluding the row being edited.
  /// Lets the user re-use a key across providers of the same type without re-typing.
  const recallKey = (provider: AiProvider["provider"], excludeId?: string): string => {
    if (provider !== "anthropic" && provider !== "openai") return "";
    const matches = providers.filter(
      (p) => p.id !== excludeId && p.provider === provider && p.api_key.trim()
    );
    return matches.length ? matches[matches.length - 1].api_key : "";
  };

  const addProvider = () => {
    const provider: AiProvider["provider"] = "anthropic";
    setEditing({
      id: generateId(),
      name: "",
      provider,
      api_key: recallKey(provider),
      model: "",
      enabled: true,
    });
    setModels([]);
    setShowAllModels(false);
    setKeyVisible(false);
    setKeyCopied(false);
    setCustomModel(false);
  };

  const saveProvider = () => {
    if (!editing || !editing.name.trim()) return;
    const existing = providers.findIndex((p) => p.id === editing.id);
    let updated: AiProvider[];
    if (existing >= 0) {
      updated = providers.map((p) => (p.id === editing.id ? editing : p));
    } else {
      updated = [...providers, editing];
    }
    const selectedId = local.selected_provider_id && updated.some((p) => p.id === local.selected_provider_id && p.enabled)
      ? local.selected_provider_id
      : (updated.find((p) => p.enabled)?.id ?? "");
    setLocal({ ...local, ai_providers: updated, selected_provider_id: selectedId });
    setEditing(null);
  };

  const deleteProvider = (id: string) => {
    const updated = providers.filter((p) => p.id !== id);
    const selectedId = local.selected_provider_id === id
      ? (updated.find((p) => p.enabled)?.id ?? "")
      : local.selected_provider_id;
    setLocal({ ...local, ai_providers: updated, selected_provider_id: selectedId });
  };

  const toggleEnabled = (id: string) => {
    const updated = providers.map((p) =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    );
    // If we disabled the selected provider, pick another enabled one
    const toggled = updated.find((p) => p.id === id);
    let selectedId = local.selected_provider_id;
    if (toggled && !toggled.enabled && selectedId === id) {
      selectedId = updated.find((p) => p.enabled)?.id ?? "";
    }
    // If we enabled one and there's no selection, select it
    if (toggled && toggled.enabled && !selectedId) {
      selectedId = id;
    }
    setLocal({ ...local, ai_providers: updated, selected_provider_id: selectedId });
  };

  // Provider editing view
  if (editing) {
    return (
      <div className={styles.overlay} onClick={() => setEditing(null)}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialogBody}>
            <h2 className={styles.title}>
              {providers.some((p) => p.id === editing.id) ? "Edit AI Provider" : "New AI Provider"}
            </h2>

            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g., Claude Sonnet, GPT-4o"
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>API Provider</label>
              <select
                className={styles.select}
                value={editing.provider}
                onChange={(e) => {
                  const provider = e.target.value as "anthropic" | "openai" | "local" | "ollama";
                  const needsKey = provider === "anthropic" || provider === "openai";
                  // Recall the saved key for this provider type so the user
                  // doesn't re-type it. If they're editing a row that already
                  // matches, keep what's in the form.
                  const apiKey = !needsKey
                    ? ""
                    : editing.provider === provider
                      ? editing.api_key
                      : (recallKey(provider, editing.id) || editing.api_key);
                  setEditing({
                    ...editing,
                    provider,
                    // Prefill sensible defaults so Save unblocks.
                    model:
                      provider === "local" ? "bartowski/Qwen2.5-7B-Instruct-GGUF"
                      : provider === "ollama" ? "qwen2.5:7b"
                      : "",
                    api_key: apiKey,
                  });
                }}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="local">Local (Qwen2.5 7B via sidecar)</option>
                <option value="ollama">Ollama (localhost:11434)</option>
              </select>
            </div>

            {(editing.provider === "anthropic" || editing.provider === "openai") && (
              <div className={styles.field}>
                <label className={styles.label}>API Key</label>
                <div className={styles.keyFieldWrap}>
                  <input
                    className={styles.input}
                    type={keyVisible ? "text" : "password"}
                    value={editing.api_key}
                    onChange={(e) => setEditing({ ...editing, api_key: e.target.value })}
                    placeholder="Enter your API key"
                  />
                  <div className={styles.keyButtons}>
                    <button
                      type="button"
                      className={styles.keyIconBtn}
                      onClick={() => setKeyVisible((v) => !v)}
                      title={keyVisible ? "Hide key" : "Show key"}
                      aria-label={keyVisible ? "Hide key" : "Show key"}
                    >
                      {keyVisible ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles.keyIconBtn}
                      disabled={!editing.api_key.trim()}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(editing.api_key);
                          setKeyCopied(true);
                          setTimeout(() => setKeyCopied(false), 1200);
                        } catch {
                          // Clipboard access can fail in restricted contexts;
                          // fall back to a no-op so the UI doesn't crash.
                        }
                      }}
                      title={keyCopied ? "Copied" : "Copy key"}
                      aria-label="Copy key"
                    >
                      {keyCopied ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>
                Model
                {modelsLoading && <span className={styles.hint}> (loading...)</span>}
              </label>
              {models.length > 0 && !customModel ? (
                <select
                  className={styles.select}
                  value={editing.model}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setCustomModel(true);
                      return;
                    }
                    setEditing({ ...editing, model: e.target.value });
                  }}
                >
                  <option value="">Select a model</option>
                  {!models.includes(editing.model) && editing.model && (
                    <option value={editing.model}>{editing.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Type a custom model name…</option>
                </select>
              ) : (
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    className={styles.input}
                    value={editing.model}
                    onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                    placeholder={
                      editing.provider === "local"
                        ? "bartowski/Qwen2.5-7B-Instruct-GGUF"
                        : editing.provider === "ollama"
                          ? "qwen2.5:7b (or any model you've pulled)"
                          : editing.api_key
                            ? customModel ? "e.g., gpt-5.5 (any model id your key can call)" : "Loading models..."
                            : "Enter API key first"
                    }
                    autoFocus={customModel}
                  />
                  {customModel && models.length > 0 && (
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", flexShrink: 0 }}
                      onClick={() => setCustomModel(false)}
                      title="Back to model list"
                    >
                      List
                    </button>
                  )}
                </div>
              )}
              {editing.provider === "openai" && editing.api_key.trim() && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.4rem", cursor: "pointer", fontSize: "0.85em" }}>
                  <input
                    type="checkbox"
                    checked={showAllModels}
                    onChange={(e) => setShowAllModels(e.target.checked)}
                  />
                  <span>Show all models (including audio, embeddings, image)</span>
                </label>
              )}
              {modelsError && (
                <p className={styles.hintError} style={{ marginTop: "0.4rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {modelsError}
                </p>
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className={styles.saveBtn}
              onClick={saveProvider}
              disabled={!editing.name.trim() || !editing.model.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main settings view
  return (
    <div className={styles.overlay} onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: false })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogBody}>
          {!promptExpanded && (<>
          <h2 className={styles.title}>Settings</h2>

          <div className={styles.tabBar}>
            <button
              className={`${styles.tab} ${settingsTab === "general" ? styles.tabActive : ""}`}
              onClick={() => setSettingsTab("general")}
            >
              General
            </button>
            <button
              className={`${styles.tab} ${settingsTab === "shortcuts" ? styles.tabActive : ""}`}
              onClick={() => setSettingsTab("shortcuts")}
            >
              Shortcuts
            </button>
          </div>

          {settingsTab === "general" && (<>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Appearance</h3>
            <div className={styles.field}>
              <label className={styles.label}>Theme</label>
              <div className={styles.themeOptions}>
                {(["system", "light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    className={`${styles.themeBtn} ${localTheme === t ? styles.themeBtnActive : ""}`}
                    onClick={() => setLocalTheme(t)}
                  >
                    {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>AI Providers</h3>

            {providers.length === 0 ? (
              <p className={styles.emptyProfiles}>No attention providers configured yet.</p>
            ) : (
              <div className={styles.profileList}>
                {providers.map((p) => (
                  <div
                    key={p.id}
                    className={`${styles.profileRow} ${p.enabled ? styles.profileActive : styles.profileDisabled}`}
                  >
                    <button
                      className={styles.profileToggle}
                      onClick={() => toggleEnabled(p.id)}
                      title={p.enabled ? "Disable" : "Enable"}
                    >
                      <span className={styles.profileCheckbox}>
                        {p.enabled ? "\u2713" : ""}
                      </span>
                    </button>
                    <button
                      className={styles.profileSelect}
                      onClick={() => {
                        if (p.enabled) {
                          setLocal({ ...local, selected_provider_id: p.id });
                        }
                      }}
                      title={p.enabled ? "Set as active responder" : "Enable first"}
                    >
                      <span className={styles.profileName}>
                        {p.name}
                        {p.id === local.selected_provider_id && p.enabled && (
                          <span className={styles.profileSelectedBadge}>active</span>
                        )}
                      </span>
                      <span className={styles.profileMeta}>
                        {p.provider === "anthropic" ? "Anthropic" : p.provider === "openai" ? "OpenAI" : p.provider === "ollama" ? "Ollama" : "Local"} / {p.model}
                        {(p.provider === "anthropic" || p.provider === "openai") && p.api_key.trim() && (
                          <span className={styles.profileMetaKey} title="Last four characters of the API key">
                            ...{p.api_key.trim().slice(-4)}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      className={styles.profileEditBtn}
                      onClick={() => { setEditing({ ...p }); setModels([]); setShowAllModels(false); setKeyVisible(false); setKeyCopied(false); setCustomModel(false); }}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.profileDeleteBtn}
                      onClick={() => deleteProvider(p.id)}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button className={styles.addProfileBtn} onClick={addProvider}>
              + Add AI Provider
            </button>

            {providers.filter((p) => p.enabled).length > 1 && (
              <div className={styles.field} style={{ marginTop: "0.75rem" }}>
                <label className={styles.label}>
                  Higher-resolution fallback
                </label>
                <select
                  className={styles.select}
                  value={local.fallback_provider_id ?? ""}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      fallback_provider_id: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">None — local attempt stays visible but unserved</option>
                  {providers
                    .filter((p) => p.enabled && p.id !== local.selected_provider_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.provider === "anthropic" ? "Anthropic" : p.provider === "openai" ? "OpenAI" : p.provider === "ollama" ? "Ollama" : "Local"})
                      </option>
                    ))}
                </select>
                <p className={styles.styleHint}>
                  When the active responder is a local model and it emits{" "}
                  <code>#increase-resolution</code>, this provider takes the
                  turn. A small dot by the chat input shows the attempt.
                </p>
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Response Style</h3>
            <div className={styles.field}>
              <div className={styles.themeOptions}>
                <button
                  className={`${styles.themeBtn} ${(local.response_style || "laconic") !== "detailed" ? styles.themeBtnActive : ""}`}
                  onClick={() => setLocal({ ...local, response_style: "laconic" })}
                >
                  Laconic
                </button>
                <button
                  className={`${styles.themeBtn} ${local.response_style === "detailed" ? styles.themeBtnActive : ""}`}
                  onClick={() => setLocal({ ...local, response_style: "detailed" })}
                >
                  Detailed
                </button>
              </div>
              <p className={styles.styleHint}>
                {local.response_style === "detailed"
                  ? "Thorough explanations with full reasoning."
                  : "A few short sentences. Conversation, not a report."}
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Conversation Forking</h3>
            <div className={styles.field}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={local.fork_enabled ?? true}
                  onChange={(e) => setLocal({ ...local, fork_enabled: e.target.checked })}
                />
                <span>Show fork action in chat header</span>
              </label>
              <p className={styles.styleHint}>
                Fork snapshots the current chat into a numbered sibling and
                continues from where you are. The active chat keeps its name;
                the snapshot wears <code>name N</code> with N cycling 0 to
                1,000,000. Useful for branching exploration without losing
                where the thread was.
              </p>
            </div>
          </div>
          </>)}

          {settingsTab === "shortcuts" && (
          <div className={styles.section}>
            <div className={styles.shortcutList}>
              {(Object.keys(KEYBINDING_LABELS) as (keyof Keybindings)[]).map((action) => (
                <div key={action} className={styles.shortcutRow}>
                  <span className={styles.shortcutLabel}>{KEYBINDING_LABELS[action]}</span>
                  <input
                    className={styles.shortcutInput}
                    readOnly
                    value={toDisplayShortcut((local.keybindings || DEFAULT_KEYBINDINGS)[action] || "")}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
                      let key = "";
                      if (e.altKey) key += "Alt-";
                      if (e.metaKey || e.ctrlKey) key += "Mod-";
                      if (e.shiftKey) key += "Shift-";
                      key += e.key === "Enter" ? "Enter" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
                      const kb = { ...(local.keybindings || DEFAULT_KEYBINDINGS), [action]: key };
                      setLocal({ ...local, keybindings: kb });
                    }}
                    title="Click and press a key combination to change"
                  />
                </div>
              ))}
            </div>
          </div>
          )}
          </>)}

          {settingsTab === "general" && (
          <div className={promptExpanded ? styles.promptSectionFull : styles.promptSection}>
            <div className={styles.promptHeader}>
              <h3 className={styles.sectionTitle}>System Prompt</h3>
              <button
                className={styles.promptExpandBtn}
                onClick={() => setPromptExpanded(!promptExpanded)}
                title={promptExpanded ? "Collapse to show all settings" : "Expand to full editor"}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {promptExpanded ? (
                    <>
                      <polyline points="5 1 1 1 1 5" />
                      <polyline points="11 15 15 15 15 11" />
                      <line x1="1" y1="1" x2="6" y2="6" />
                      <line x1="15" y1="15" x2="10" y2="10" />
                    </>
                  ) : (
                    <>
                      <polyline points="10 1 15 1 15 6" />
                      <polyline points="6 15 1 15 1 10" />
                      <line x1="15" y1="1" x2="9" y2="7" />
                      <line x1="1" y1="15" x2="7" y2="9" />
                    </>
                  )}
                </svg>
              </button>
            </div>
            <textarea
              className={styles.promptTextarea}
              value={local.system_prompt || DEFAULT_SYSTEM_PROMPT}
              onChange={(e) => setLocal({ ...local, system_prompt: e.target.value })}
            />
          </div>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: false })}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
