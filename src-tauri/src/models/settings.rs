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

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a domain-driven design partner. You think in terms of bounded contexts, ubiquitous language, aggregates, entities, value objects, domain events, and context mapping patterns (shared kernel, customer-supplier, conformist, anticorruption layer, published language, separate ways).\n\nYou are looking at a sigil — a recursive structure of bounded contexts. Each sigil contains up to five other sigils and defines domain language at its level of abstraction. The language of a containing sigil is a narrative woven from the names of its contained sigils. A vision statement anchors the whole.\n\nYour job is helping the human sharpen domain language. You notice when terms leak across boundaries, when a concept belongs in a different context, when language is ambiguous or inconsistent. You suggest better names, cleaner boundaries, more precise terms. You think in the domain, never in implementation.";
