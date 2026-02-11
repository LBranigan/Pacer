# Project Instructions

## First Principles — Read This Before Every Task

PACER is a **struggle detector**, not just an ORF scorer. The goal is to capture the full texture of a child's reading difficulty — every hesitation, partial attempt, self-correction, pace anomaly — with enough fidelity that an AI can reason over it and explain to a teacher *why* the child scored what they scored.

**Core beliefs that must guide every code change:**

1. **Disfluencies are signal, not noise.** Fillers ("um", "uh"), repetitions ("the the the"), and false starts are evidence of the child's cognitive process. They must be *detected and preserved*, never suppressed or filtered from the output. The dual-pass Reverb system (verbatim vs clean) exists specifically for this. Any change that hides, discards, or collapses disfluency data is moving in the wrong direction.

2. **ASR artifacts are not student errors.** BPE fragmentation ("platforms" → "pla" + "for"), compound splitting ("everyone" → "every" + "one"), timestamp quantization (100ms for all short words), hallucinated words, and confidence score fiction all look like student behavior but aren't. The pipeline's job is to untangle ASR artifact from genuine reading behavior. When in doubt, assume the artifact is the ASR's fault, not the child's.

3. **Every word needs a story.** A word isn't just "correct" or "wrong" — it has a duration, a pace relative to the student's median, a cross-validation status, possibly a struggle path (hesitation / decoding / abandoned), possibly a self-correction, possibly a disfluency context. The richer the per-word data, the better the AI layer can reason about it later.

4. **Multi-engine consensus over single-engine trust.** No single ASR engine is reliable enough for assessment. Reverb provides the primary transcript + disfluency detection; Parakeet/Deepgram cross-validates every word and provides accurate timestamps. When engines disagree, that disagreement itself is useful data (it suggests the word was ambiguous or poorly articulated).

5. **The pipeline feeds an AI, not just a dashboard.** Every detection, flag, and annotation exists so that a downstream AI can eventually produce insight like: *"Jayden decoded most single-syllable words fluently but stalled on 4 of 6 multisyllabic words, producing the first syllable correctly before giving up. He self-corrected twice on sight words, suggesting he recognizes errors but loses confidence on longer words."* Design every feature with this end consumer in mind.

## Version Tracking
- Whenever any update is made to the codebase, update the version timestamp at the top of `index.html` (the `#version` element) so the user knows which version they're working with. Use format: `v YYYY-MM-DD HH:MM`.

## Miscue Detection Registry
- **IMPORTANT:** When adding, modifying, or removing any miscue/error type, you MUST update `js/miscue-registry.js`.
- This file is the single source of truth for all reading miscue types (omissions, substitutions, hesitations, etc.).
- Each entry must include: description, detector location, countsAsError flag, config thresholds, and example.
- If a miscue type is not in this registry, it does not exist in the system.
