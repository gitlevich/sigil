use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sigil {
    pub name: String,
    pub root_path: String,
    pub vision: String,
    pub root: Context,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affordance {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contrast {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    pub name: String,
    pub path: String,
    pub domain_language: String,
    pub affordances: Vec<Affordance>,
    pub contrasts: Vec<Contrast>,
    pub children: Vec<Context>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}
