# DecisionFrame

A DecisionFrame is a single unit of experience: everything that happened between my last decision and this one. It captures a moment where I was presented with context and made a choice about what to say or do.

Structure on disk:
```
frame-{timestamp}/
  language.md    — the frame itself
```

The `language.md` of a frame contains:
- **Viewing**: which sigil was in focus (the navigation context at decision time)
- **User**: what the user said
- **Partner**: what I responded

The frame's granularity is one conversation turn. All the frames I saw in this conversation until I made this decision form the temporal context of the frame. The frame itself is what crystallized from that context.