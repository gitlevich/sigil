import { useState, useEffect } from "react";
import { useAppState, useAppDispatch, ThemePreference } from "../../state/AppContext";
import { Settings, AiProfile, api } from "../../tauri";
import styles from "./SettingsDialog.module.css";

const DEFAULT_SYSTEM_PROMPT = `You are reviewing a hierarchical application sigil. A sigil is structured as a tree of bounded contexts. Each context defines domain language at its level of abstraction and may contain up to five sub-contexts. Each context has a domain language document describing what it is and why it exists, and optionally technical decisions describing architectural and implementation choices. Technical decisions inherit from parent to child unless overridden. The root includes a vision statement defining the application's purpose. Your role is to review this sigil for coherence, completeness, and readiness for implementation. Identify gaps, ambiguities, contradictions, missing contexts, and unclear language.`;

function generateId() {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SettingsDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [local, setLocal] = useState<Settings>(state.settings);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(state.themePreference);
  const [editingProfile, setEditingProfile] = useState<AiProfile | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    setLocal(state.settings);
    setLocalTheme(state.themePreference);
  }, [state.settings, state.themePreference]);

  // Fetch models when editing a profile with an API key
  useEffect(() => {
    if (!editingProfile || !editingProfile.api_key.trim()) {
      setModels([]);
      return;
    }
    setModelsLoading(true);
    api.listModels(editingProfile.provider, editingProfile.api_key)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [editingProfile?.provider, editingProfile?.api_key]);

  if (!state.settingsOpen) return null;

  const handleSave = () => {
    dispatch({ type: "SET_SETTINGS", settings: local });
    dispatch({ type: "SET_THEME", theme: localTheme });
    dispatch({ type: "SET_SETTINGS_OPEN", open: false });
  };

  const addProfile = () => {
    const newProfile: AiProfile = {
      id: generateId(),
      name: "",
      provider: "anthropic",
      api_key: "",
      model: "",
    };
    setEditingProfile(newProfile);
    setModels([]);
  };

  const saveProfile = () => {
    if (!editingProfile || !editingProfile.name.trim()) return;
    const existing = local.profiles.findIndex((p) => p.id === editingProfile.id);
    let profiles: AiProfile[];
    if (existing >= 0) {
      profiles = local.profiles.map((p) => (p.id === editingProfile.id ? editingProfile : p));
    } else {
      profiles = [...local.profiles, editingProfile];
    }
    // If this is the first profile or no active profile, make it active
    const activeId = local.active_profile_id && profiles.some((p) => p.id === local.active_profile_id)
      ? local.active_profile_id
      : editingProfile.id;
    setLocal({ ...local, profiles, active_profile_id: activeId });
    setEditingProfile(null);
  };

  const deleteProfile = (id: string) => {
    const profiles = local.profiles.filter((p) => p.id !== id);
    const activeId = local.active_profile_id === id
      ? (profiles[0]?.id ?? "")
      : local.active_profile_id;
    setLocal({ ...local, profiles, active_profile_id: activeId });
  };

  // Profile editing view
  if (editingProfile) {
    return (
      <div className={styles.overlay} onClick={() => setEditingProfile(null)}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialogBody}>
            <h2 className={styles.title}>
              {local.profiles.some((p) => p.id === editingProfile.id) ? "Edit Profile" : "New Profile"}
            </h2>

            <div className={styles.field}>
              <label className={styles.label}>Profile Name</label>
              <input
                className={styles.input}
                value={editingProfile.name}
                onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                placeholder="e.g., Claude, ChatGPT"
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Provider</label>
              <select
                className={styles.select}
                value={editingProfile.provider}
                onChange={(e) => setEditingProfile({
                  ...editingProfile,
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
                value={editingProfile.api_key}
                onChange={(e) => setEditingProfile({ ...editingProfile, api_key: e.target.value })}
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
                  value={editingProfile.model}
                  onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })}
                >
                  <option value="">Select a model</option>
                  {!models.includes(editingProfile.model) && editingProfile.model && (
                    <option value={editingProfile.model}>{editingProfile.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={styles.input}
                  value={editingProfile.model}
                  onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })}
                  placeholder={editingProfile.api_key ? "Loading models..." : "Enter API key first"}
                />
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => setEditingProfile(null)}>
              Cancel
            </button>
            <button
              className={styles.saveBtn}
              onClick={saveProfile}
              disabled={!editingProfile.name.trim() || !editingProfile.model.trim()}
            >
              Save Profile
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
            <h3 className={styles.sectionTitle}>AI Profiles</h3>

            {local.profiles.length === 0 ? (
              <p className={styles.emptyProfiles}>No profiles configured yet.</p>
            ) : (
              <div className={styles.profileList}>
                {local.profiles.map((p) => (
                  <div
                    key={p.id}
                    className={`${styles.profileRow} ${p.id === local.active_profile_id ? styles.profileActive : ""}`}
                  >
                    <button
                      className={styles.profileSelect}
                      onClick={() => setLocal({ ...local, active_profile_id: p.id })}
                      title="Set as active"
                    >
                      <span className={styles.profileRadio}>
                        {p.id === local.active_profile_id ? "\u25C9" : "\u25CB"}
                      </span>
                      <span className={styles.profileName}>{p.name}</span>
                      <span className={styles.profileMeta}>
                        {p.provider === "anthropic" ? "Anthropic" : "OpenAI"} / {p.model}
                      </span>
                    </button>
                    <button
                      className={styles.profileEditBtn}
                      onClick={() => { setEditingProfile({ ...p }); setModels([]); }}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.profileDeleteBtn}
                      onClick={() => deleteProfile(p.id)}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button className={styles.addProfileBtn} onClick={addProfile}>
              + Add Profile
            </button>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Response Style</h3>
            <div className={styles.field}>
              <div className={styles.themeOptions}>
                <button
                  className={`${styles.themeBtn} ${(local.response_style || "default") === "default" ? styles.themeBtnActive : ""}`}
                  onClick={() => setLocal({ ...local, response_style: "default" })}
                >
                  Default
                </button>
                <button
                  className={`${styles.themeBtn} ${local.response_style === "laconic" ? styles.themeBtnActive : ""}`}
                  onClick={() => setLocal({ ...local, response_style: "laconic" })}
                >
                  Laconic
                </button>
              </div>
              <p className={styles.styleHint}>
                {local.response_style === "laconic"
                  ? "Concise. As few words as required to convey the information losslessly."
                  : "Full explanations and reasoning."}
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>System Prompt</h3>
            <div className={styles.field}>
              <textarea
                className={styles.textarea}
                value={local.system_prompt || DEFAULT_SYSTEM_PROMPT}
                onChange={(e) => setLocal({ ...local, system_prompt: e.target.value })}
                rows={6}
              />
            </div>
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
