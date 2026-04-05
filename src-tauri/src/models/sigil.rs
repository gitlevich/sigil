use serde::{Deserialize, Serialize};

/// The open specification — the workspace's view of the sigil hierarchy on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSpec {
    pub name: String,
    pub root_path: String,
    pub vision: String,
    pub root: SigilFolder,
    #[serde(default)]
    pub imported_ontologies: Option<SigilFolder>,
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

/// A SigilFolder — the filesystem projection of a Sigil.
/// Contains language file, affordance files, invariant files, and child SigilFolders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigilFolder {
    pub name: String,
    pub path: String,
    pub language: String,
    pub affordances: Vec<Affordance>,
    pub invariants: Vec<Invariant>,
    pub children: Vec<SigilFolder>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub is_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}
