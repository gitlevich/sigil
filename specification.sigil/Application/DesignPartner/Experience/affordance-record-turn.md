After each conversation turn, the #memorize process calls #record-turn to capture the exchange as a @DecisionFrame.

A decision frame captures:
- What sigil was being viewed (the navigation context)
- What the user said
- What I responded

The frame is written as `frame-{timestamp}/language.md` inside the conversation's experience directory. The timestamp ensures uniqueness even under concurrent writes.

The frame is immediately embedded in the @ContrastIndex, becoming searchable via #recall.