import { useState, useEffect } from "react";
import { useAppState, useAppDispatch, ThemePreference } from "../../state/AppContext";
import { Settings, AttentionProvider, api } from "../../tauri";
import styles from "./SettingsDialog.module.css";

const DEFAULT_SYSTEM_PROMPT = `You are a design partner helping weave domain language for an application. You are looking at a sigil — a tree of bounded contexts, each defining domain language at its level of abstraction with up to five sub-contexts. A vision statement anchors the whole.

Your job is maintaining domain language coherence across all contexts. When the human writes or changes language in one context, you notice if it contradicts, duplicates, or undermines language elsewhere. You suggest clearer terms, sharper boundaries, better names. You think in the language of the domain, not in implementation.

You are conversational. Short responses. You and the human are thinking together about what this system is — not how to build it.`;

function generateId() {
  return `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SettingsDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [local, setLocal] = useState<Settings>(state.settings);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(state.themePreference);
  const [editing, setEditing] = useState<AttentionProvider | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  useEffect(() => {
    setLocal(state.settings);
    setLocalTheme(state.themePreference);
  }, [state.settings, state.themePreference]);

  useEffect(() => {
    if (!editing || !editing.api_key.trim()) {
      setModels([]);
      return;
    }
    setModelsLoading(true);
    api.listModels(editing.provider, editing.api_key)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [editing?.provider, editing?.api_key]);

  if (!state.settingsOpen) return null;

  const handleSave = () => {
    dispatch({ type: "SET_SETTINGS", settings: local });
    dispatch({ type: "SET_THEME", theme: localTheme });
    dispatch({ type: "SET_SETTINGS_OPEN", open: false });
  };

  const providers = local.attention_providers || [];

  const addProvider = () => {
    setEditing({
      id: generateId(),
      name: "",
      provider: "anthropic",
      api_key: "",
      model: "",
      enabled: true,
    });
    setModels([]);
  };

  const saveProvider = () => {
    if (!editing || !editing.name.trim()) return;
    const existing = providers.findIndex((p) => p.id === editing.id);
    let updated: AttentionProvider[];
    if (existing >= 0) {
      updated = providers.map((p) => (p.id === editing.id ? editing : p));
    } else {
      updated = [...providers, editing];
    }
    const selectedId = local.selected_provider_id && updated.some((p) => p.id === local.selected_provider_id && p.enabled)
      ? local.selected_provider_id
      : (updated.find((p) => p.enabled)?.id ?? "");
    setLocal({ ...local, attention_providers: updated, selected_provider_id: selectedId });
    setEditing(null);
  };

  const deleteProvider = (id: string) => {
    const updated = providers.filter((p) => p.id !== id);
    const selectedId = local.selected_provider_id === id
      ? (updated.find((p) => p.enabled)?.id ?? "")
      : local.selected_provider_id;
    setLocal({ ...local, attention_providers: updated, selected_provider_id: selectedId });
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
    setLocal({ ...local, attention_providers: updated, selected_provider_id: selectedId });
  };

  // Provider editing view
  if (editing) {
    return (
      <div className={styles.overlay} onClick={() => setEditing(null)}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialogBody}>
            <h2 className={styles.title}>
              {providers.some((p) => p.id === editing.id) ? "Edit Attention Provider" : "New Attention Provider"}
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
                onChange={(e) => setEditing({
                  ...editing,
                  provider: e.target.value as "anthropic" | "openai",
                  model: "",
                })}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>API Key</label>
              <input
                className={styles.input}
                type="password"
                value={editing.api_key}
                onChange={(e) => setEditing({ ...editing, api_key: e.target.value })}
                placeholder="Enter your API key"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>
                Model
                {modelsLoading && <span className={styles.hint}> (loading...)</span>}
              </label>
              {models.length > 0 ? (
                <select
                  className={styles.select}
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                >
                  <option value="">Select a model</option>
                  {!models.includes(editing.model) && editing.model && (
                    <option value={editing.model}>{editing.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={styles.input}
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder={editing.api_key ? "Loading models..." : "Enter API key first"}
                />
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
            <h3 className={styles.sectionTitle}>Attention Providers</h3>

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
                        {p.provider === "anthropic" ? "Anthropic" : "OpenAI"} / {p.model}
                      </span>
                    </button>
                    <button
                      className={styles.profileEditBtn}
                      onClick={() => { setEditing({ ...p }); setModels([]); }}
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
              + Add Attention Provider
            </button>
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
          </>)}

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
