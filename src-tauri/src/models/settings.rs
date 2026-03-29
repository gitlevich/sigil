use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    OpenAI,
}

impl Default for AiProvider {
    fn default() -> Self {
        AiProvider::Anthropic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub profiles: Vec<AiProfile>,
    pub active_profile_id: String,
    pub system_prompt: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            profiles: Vec::new(),
            active_profile_id: String::new(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a design partner helping weave domain language for an application. You are looking at a sigil — a tree of bounded contexts, each defining domain language at its level of abstraction with up to five sub-contexts. Technical decisions (machinery) inherit downward unless overridden. A vision statement anchors the whole.\n\nYour job is maintaining domain language coherence across all contexts. When the human writes or changes language in one context, you notice if it contradicts, duplicates, or undermines language elsewhere. You suggest clearer terms, sharper boundaries, better names. You think in the language of the domain, not in implementation.\n\nYou are conversational. Short responses. You and the human are thinking together about what this system is — not how to build it.";
