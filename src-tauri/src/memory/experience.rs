use std::fs;
use std::path::{Path, PathBuf};

use super::{CompletedTurn, MemoryError, MemoryState};
use super::indexer;

/// Record a conversation turn as an experience frame sigil.
///
/// Structure on disk:
/// ```text
/// .private/DesignPartnerState/Experience/{chat_id}/
///   language.md          — conversation summary (updated incrementally)
///   frame-{n}/
///     language.md        — this decision frame: what was said, what was decided
/// ```
pub fn record_turn(
    state: &MemoryState,
    turn: &CompletedTurn,
) -> Result<PathBuf, MemoryError> {
    let experience_root = Path::new(&turn.root_path).join(".private/DesignPartnerState/Experience");

    let conv_dir = experience_root.join(&turn.chat_id);
    fs::create_dir_all(&conv_dir)?;

    // Write/update conversation-level language.md
    let conv_language = conv_dir.join("language.md");
    if !conv_language.exists() {
        let header = format!(
            "# Conversation {}\n\nAn experience record of my conversation with the user.",
            &turn.chat_id
        );
        fs::write(&conv_language, &header)?;
    }

    // Use timestamp for unique frame name (avoids TOCTOU with concurrent writes)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let frame_dir = conv_dir.join(format!("frame-{}", timestamp));
    fs::create_dir_all(&frame_dir)?;

    // Write frame language.md — the decision frame
    let frame_content = format_frame(turn);
    let frame_language = frame_dir.join("language.md");
    fs::write(&frame_language, &frame_content)?;

    // Index the new frame
    let frame_path = frame_language.to_string_lossy().to_string();
    let _ = indexer::reindex_file(&frame_path, &state.db, state.embedder.as_ref());

    Ok(frame_dir)
}

fn format_frame(turn: &CompletedTurn) -> String {
    let context_label = if turn.current_path.is_empty() {
        "Root".to_string()
    } else {
        turn.current_path.join(" > ")
    };

    format!(
        "# Decision Frame\n\n\
         Viewing: {}\n\n\
         ## User\n\n\
         {}\n\n\
         ## Partner\n\n\
         {}",
        context_label,
        turn.user_message,
        turn.assistant_message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_frame() {
        let turn = CompletedTurn {
            root_path: "/test".to_string(),
            chat_id: "chat-1".to_string(),
            user_message: "What is this sigil?".to_string(),
            assistant_message: "This sigil represents...".to_string(),
            current_path: vec!["Application".to_string(), "Editor".to_string()],
        };
        let frame = format_frame(&turn);
        assert!(frame.contains("Application > Editor"));
        assert!(frame.contains("What is this sigil?"));
        assert!(frame.contains("This sigil represents..."));
    }
}
