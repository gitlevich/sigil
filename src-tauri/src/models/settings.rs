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
pub struct Settings {
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: AiProvider::Anthropic,
            api_key: String::new(),
            model: "claude-sonnet-4-20250514".to_string(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are reviewing a hierarchical application specification. This specification is structured as a tree of bounded contexts. Each context defines ubiquitous language at its level of abstraction and may contain up to five sub-contexts. Each context has a spec body describing what it is and why it exists, and optionally technical decisions describing architectural and implementation choices. Technical decisions inherit from parent to child unless overridden. The root includes a vision statement defining the application's purpose. Your role is to review this specification for coherence, completeness, and readiness for implementation. Identify gaps, ambiguities, contradictions, missing contexts, and unclear language.";
