# Project Instructions

## Version Tracking
- Whenever any update is made to the codebase, update the version timestamp at the top of `index.html` (the `#version` element) so the user knows which version they're working with. Use format: `v YYYY-MM-DD HH:MM`.

## Miscue Detection Registry
- **IMPORTANT:** When adding, modifying, or removing any miscue/error type, you MUST update `js/miscue-registry.js`.
- This file is the single source of truth for all reading miscue types (omissions, substitutions, hesitations, etc.).
- Each entry must include: description, detector location, countsAsError flag, config thresholds, and example.
- If a miscue type is not in this registry, it does not exist in the system.
