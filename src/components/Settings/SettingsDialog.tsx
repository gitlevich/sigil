import { useState, useEffect } from "react";
import { useAppState, useAppDispatch, ThemePreference } from "../../state/AppContext";
import { Settings, api } from "../../tauri";
import styles from "./SettingsDialog.module.css";

const DEFAULT_SYSTEM_PROMPT = `You are reviewing a hierarchical application sigil. A sigil is structured as a tree of bounded contexts. Each context defines domain language at its level of abstraction and may contain up to five sub-contexts. Each context has a domain language document describing what it is and why it exists, and optionally technical decisions describing architectural and implementation choices. Technical decisions inherit from parent to child unless overridden. The root includes a vision statement defining the application's purpose. Your role is to review this sigil for coherence, completeness, and readiness for implementation. Identify gaps, ambiguities, contradictions, missing contexts, and unclear language.`;

export function SettingsDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [local, setLocal] = useState<Settings>(state.settings);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(state.themePreference);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(state.settings);
    setLocalTheme(state.themePreference);
  }, [state.settings, state.themePreference]);

  // Fetch models when provider or API key changes
  useEffect(() => {
    if (!state.settingsOpen) return;
    if (!local.api_key.trim()) {
      setModels([]);
      setModelsError(null);
      return;
    }

    setModelsLoading(true);
    setModelsError(null);

    api.listModels(local.provider, local.api_key)
      .then((result) => {
        setModels(result);
        // If current model isn't in the list, keep it (user may have typed a valid one)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setModelsError(msg);
        setModels([]);
      })
      .finally(() => setModelsLoading(false));
  }, [local.provider, local.api_key, state.settingsOpen]);

  if (!state.settingsOpen) return null;

  const handleSave = () => {
    dispatch({ type: "SET_SETTINGS", settings: local });
    dispatch({ type: "SET_THEME", theme: localTheme });
    dispatch({ type: "SET_SETTINGS_OPEN", open: false });
  };

  return (
    <div className={styles.overlay} onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: false })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
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
          <h3 className={styles.sectionTitle}>AI Configuration</h3>

          <div className={styles.field}>
            <label className={styles.label}>Provider</label>
            <select
              className={styles.select}
              value={local.provider}
              onChange={(e) => setLocal({ ...local, provider: e.target.value as "anthropic" | "openai" })}
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
              value={local.api_key}
              onChange={(e) => setLocal({ ...local, api_key: e.target.value })}
              placeholder="Enter your API key"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Model
              {modelsLoading && <span className={styles.hint}> (loading...)</span>}
              {modelsError && <span className={styles.hintError}> (failed to fetch models)</span>}
            </label>
            {models.length > 0 ? (
              <select
                className={styles.select}
                value={local.model}
                onChange={(e) => setLocal({ ...local, model: e.target.value })}
              >
                {!models.includes(local.model) && local.model && (
                  <option value={local.model}>{local.model}</option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className={styles.input}
                value={local.model}
                onChange={(e) => setLocal({ ...local, model: e.target.value })}
                placeholder={local.api_key ? "Enter API key to load models" : "e.g., claude-sonnet-4-20250514"}
              />
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>System Prompt</label>
            <textarea
              className={styles.textarea}
              value={local.system_prompt || DEFAULT_SYSTEM_PROMPT}
              onChange={(e) => setLocal({ ...local, system_prompt: e.target.value })}
              rows={6}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: false })}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
