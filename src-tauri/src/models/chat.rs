use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

/// An image the @user has shown to @DesignPartner through @Chat.
/// Bytes live on disk under `.private/chats/attachments/<chatId>/`; the
/// @ChatMessage carries only the path so chat.json stays readable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachment {
    pub path: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ChatAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chat {
    pub id: String,
    pub name: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatInfo {
    pub id: String,
    pub name: String,
    pub message_count: usize,
    pub last_modified: u64,
}
