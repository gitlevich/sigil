# Session: curious-jingling-crane
**Date**: 2026-04-02 06:50 UTC  
**Source**: Claude  
**Session ID**: `c4a01507-f373-490d-9701-c04cbb3fb388`

---

### Assistant (06:50 UTC)

Now let me read the key files I'll need to modify or reference.

### Assistant (06:52 UTC)

Good. I've read everything. Let me map and project. Discoveries 4 and 5 are already substantially in the spec (CoherenceMetric/language.md). I'll verify and augment where needed. Let me now write all the edits.

**Discovery 1: Fixed point** — belongs in SigilEngineering/language.md.

### Assistant (06:52 UTC)

*Files: [docs/specification/sigil-editor/Libs/AttentionLanguage/SigilEngineering/language.md](../../specification.sigil/sigil-editor/Libs/AttentionLanguage/SigilEngineering/language.md)*

**Discovery 2: Function approximation** — Sigil/language.md and SpatialResolution.

### Assistant (06:52 UTC)

*Files: [docs/specification/sigil-editor/Libs/AttentionLanguage/Sigil/language.md](../../specification.sigil/sigil-editor/Libs/AttentionLanguage/Sigil/language.md), [docs/specification/sigil-editor/Libs/AttentionLanguage/Resolution/SpatialResolution/language.md](../../specification.sigil/sigil-editor/Libs/AttentionLanguage/Resolution/SpatialResolution/language.md)*

**Discovery 3: Superposition and collapse at leaves** — Coverage/language.md.

### Assistant (06:52 UTC)

*Files: [docs/specification/sigil-editor/SigilEditor/DesignPartner/Coverage/language.md](../../specification.sigil/sigil-editor/SigilEditor/DesignPartner/Coverage/language.md)*

**Discoveries 4+5: Cross-projection + drift** — already projected into CoherenceMetric/language.md. Let me verify.

The CoherenceMetric/language.md already contains both the drift detection paragraph and the cross-projection paragraph. These are fully projected.

**Discovery 6: Generative capacity** — just projected into Coverage above.

**Discovery 7: Contrasts are not contracts** — just projected into Sigil/language.md above.

Now **Discovery 8: Lexical scoping** — already in DesignPartner/language.md ("Ancestor sigils are in scope and binding — contradicting an ancestor's term or violating an inherited invariant is incoherent. Same concept in a different branch with different affordances and invariants is fine."). Already projected.

**Discovery 9: Affordance = verb, Sigil = noun** — projected into Sigil/language.md above. Let me also add it to the EcologicalPsychology Affordance.

### Assistant (06:53 UTC)

*Files: [docs/specification/sigil-editor/Libs/EcologicalPsychology/Affordance/language.md](../../specification.sigil/sigil-editor/Libs/EcologicalPsychology/Affordance/language.md)*

This is the Gibson-style ecological psychology definition. Discovery 9 bridges to AttentionLanguage. The right place for the verb/noun line is Sigil (already done). Adding it here would mix ontology layers. I'll leave EcologicalPsychology/Affordance as-is.

Now let me also add the "contrasts are not contracts" clarification to Contrast/language.md.

### Assistant (06:53 UTC)

*Files: [docs/specification/sigil-editor/Libs/AttentionLanguage/Contrast/language.md](../../specification.sigil/sigil-editor/Libs/AttentionLanguage/Contrast/language.md)*

Now update todos and the memory file.

### Assistant (06:53 UTC)

All 10 projected. Summary of what went where:

**Written new content:**
- **SigilEngineering/language.md** — fixed point (#1) + domain-agnostic (#10)
- **Sigil/language.md** — function approximation (#2), sigil-is-the-contract (#7), enterable=sigil/doable=affordance (#9)
- **SpatialResolution/language.md** — leaf granularity = spatial resolution (#2)
- **Coverage/language.md** — collapsed vs superposition vs ambiguous middle (#3), generative capacity of domain language (#6)
- **Contrast/language.md** — contrast alone is not a contract (#7)

**Already in spec (verified, no changes needed):**
- **CoherenceMetric/language.md** — cross-projection alignment (#4) + drift detection (#5)
- **DesignPartner/language.md** — lexical scoping of contradiction (#8)

### Assistant (06:53 UTC)

Understood.

### Assistant (06:59 UTC)

Good read. The observation about Coverage and CoherenceMetric being "powerful but partly ungrounded" is accurate — they have clear semantics but thin affordance surfaces. The partner knows *what* to check but the spec doesn't yet articulate *how* it experiences doing so.

The handoff gap is real too. The vision says "done means a coding agent can project the spec into working code" but nothing in the spec defines the boundary between coverage-complete and projection-ready. That's a missing sigil or invariant.

### Assistant (07:00 UTC)

Two moves:

**1. Ground the partner's experience in Coverage and CoherenceMetric.**

Right now the affordances say *what* gets checked (trace vision, measure name-fit, measure boundary-sharpness) but not *what the partner does when it acts*. The partner traces a vision sentence — and then what? It hits a gap. How does it surface that? It doesn't invent — but what *does* it produce? A question? A contrast it noticed? A candidate name held at arm's length?

Proposal: add affordances to Coverage and CoherenceMetric that describe the partner's output moves — the verbs it actually performs. Something like `#probe` (generate a statement in the domain language to test where it lands), `#report-fracture` (surface a disagreement between projections with the specific contrasts that diverge), `#hold-candidate` (offer a name or structure without committing it — the author collapses or discards).

**2. Add a ProjectionReady invariant or sigil.**

The vision says "done means a coding agent can project." That's the stop condition for the whole process, but it has no sigil. Coverage-complete is necessary but not sufficient — you also need every leaf collapsed (not in superposition), every invariant testable by a coding agent, and every affordance expressible as an operation.

Proposal: either a new invariant on Coverage (`invariant-projection-ready`) or a sibling to Coverage under DesignPartner — a `ProjectionReadiness` sigil that defines the boundary. Its invariants would be: no leaf in ambiguous superposition, all invariants are verifiable from the projection alone, all affordances map to operations the target medium supports.

The first move deepens existing surface. The second closes the gap between "specified" and "buildable." I'd start with the second — it's a missing structural piece. The first is refinement.

### Assistant (07:01 UTC)

I don't have access to other conversations. Can you paste the key result or point me to where it landed on disk?

### Assistant (07:01 UTC)

There's an uncommitted change to `OntologyTree/language.md` that I didn't make — that's likely from the other conversation. Let me check what's new on disk under DesignPartner.

### Assistant (07:01 UTC)

That's only my changes from earlier. Let me check the OntologyTree file — that's the one I didn't touch.

### Assistant (07:01 UTC)

Got it — that OntologyTree change is yours too. So the DesignPartner conversation results aren't on disk yet as new files. What specifically came out of that conversation that addresses the two gaps (partner's output moves, projection-readiness)?

### Assistant (07:03 UTC)

All of them mention it — it's in the CLAUDE.md context. Let me search for the specific conversation titled "DesignPartner" by looking at today's conversations and ones mentioning projection-ready or the specific gaps.

### Assistant (07:03 UTC)

Found it. `1df80dcb` — "We're going to focus now on Design Partner." Let me extract the key conclusions.
