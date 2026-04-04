use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sigil {
    pub name: String,
    pub root_path: String,
    pub vision: String,
    pub root: Context,
    #[serde(default)]
    pub imported_ontologies: Option<Context>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affordance {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invariant {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    pub name: String,
    pub path: String,
    pub domain_language: String,
    pub affordances: Vec<Affordance>,
    pub invariants: Vec<Invariant>,
    pub children: Vec<Context>,
    #[serde(default)]
    pub is_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}
