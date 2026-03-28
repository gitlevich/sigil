use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecTree {
    pub name: String,
    pub root_path: String,
    pub vision: String,
    pub root: Context,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    pub name: String,
    pub path: String,
    pub spec_body: String,
    pub technical_decisions: Option<String>,
    pub children: Vec<Context>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}
