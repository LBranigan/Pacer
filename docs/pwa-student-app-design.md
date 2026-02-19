# PACER PWA — Student-Facing App Design

## Overview

PACER is being redesigned as a Progressive Web App (PWA) that works on any device (Android, iPhone, iPad, Chromebook). The student uses it independently to collect their own oral reading fluency data. The full dataset + AI executive summary goes to the teacher dashboard. The student sees a few gamified stats, Rhythm Remix, and Word Maze.

## Design Philosophy

**Core principle: get out of the kid's way.**

- Dead simple, minimal button presses
- No mascots, no emojis as primary UI, no "babyish" elements
- Designed for older kids (grades 3-8) who use TikTok, Discord, Spotify
- Validate inputs (mic, photo) without making it feel like a wizard
- During recording: zero distractions

## Design Exploration (Round 1 — Rejected)

Three initial mockups were created and rejected for being too childish, too many screens, and too many button presses:

- **Mockup A "Mission Control"** — Space theme with rocket progress tracker. Too gamified.
- **Mockup B "Reading Buddy"** — Bear mascot with speech bubbles. Too young.
- **Mockup C "Clean Minimal"** — Apple-like but still too many wizard steps.

**Key feedback:** "too babyish and too much visual and button clicks that are necessary"

## Design Exploration (Round 2)

Three more mature designs were created:

- **Mockup D "One Flow"** — Dark, Spotify-like. Single screen that morphs. Passive mic check.
- **Mockup E "Status Feed"** — Everything in one scrolling feed, no page transitions.
- **Mockup F "Fullscreen"** — Vercel/Linear-inspired. Each phase owns the entire screen.

**Mockup D was selected** for further development and became `mockup-d-v2.html`.

## Current Design: Mockup D v2

**File:** `mockups/mockup-d-v2.html`

### Visual Design
- Dark theme (`#111` background, `#1a1a1a` surfaces)
- Inter font family
- Minimal borders, subtle depth
- No emojis as functional UI (only in activity cards)
- Calm, confident, not flashy

### Complete Flow

#### 1. Google Sign-In
- Centered PACER logo + "Oral Reading Fluency" subtitle
- Single "Sign in with Google" button
- This is the teacher's Google account — authenticates which class roster to load

#### 2. Student Selection ("Who's reading?")
- Class roster rendered as a scrollable list
- Tap a student name → row highlights → **Continue button animates open directly below the selected row** (slides down from 0 height, not from bottom of screen)
- "Add new student" input + Add button at bottom of list (replaces search — search was removed)
- No bottom Continue button — the continue action lives inline with the selection
- Adding a new student auto-selects them and scrolls to them

#### 3. Mic Check (automatic)
- Auto-detects microphone via `navigator.mediaDevices.enumerateDevices()`
- Checks device labels for "USB", "Bluetooth", "Headset", etc. to distinguish external from built-in
- **External mic detected:** Green confirmation with device name
- **No external mic:** Amber warning: "Audio quality may be lower. For best results, connect a USB or Bluetooth microphone. You can still continue with the built-in mic."
- Student taps Continue either way — this is informational, not blocking

#### 4. Pre-Record
- Calm, spacious screen
- Faint abstract visual at top (flowing line at 18% opacity — atmospheric, not distracting)
- Copy: *"Pick up your favorite book, take a breath, tap record when you're ready."*
  - Lowercase feel, font-weight 500, muted color — relaxed, not commanding
- Record button: regular rounded rectangle with small red dot + "Record" text
  - NOT a big red circle — that was rejected as too intimidating
  - Subtle border, neutral background, calm

#### 5. Countdown
- Full-screen 3... 2... 1... (large animated numbers)
- "Get ready..." text during countdown
- Then: "Begin reading after the beep"
- Actual 880Hz beep via Web Audio API
- Automatically transitions to recording

#### 6. Recording (minimal — zero distractions)
- Blinking red dot (the only visual indicator)
- Big timer counting up: `0:23`
- "of 1:00" below (60-second cap)
- "Done reading" button with small red square icon
- "Start over" button fades in after 3 seconds (once student has started talking)
- Auto-stops at 60 seconds
- **No waveform animation** — explicitly removed as too distracting
- **No PACER logo** prominence — topbar logo is at 30% opacity during recording

#### 7. Recording Done
- Green checkmark animation (pops in)
- "Nice work!" heading
- Recorded duration shown
- Single button: "Next: Snap the page"

#### 8. Photo Capture (fullscreen camera — already open)
- **Camera is already open** — no separate instructions page, no "Open Camera" button
- Fullscreen black viewfinder with corner brackets framing the shot
- Three superimposed frosted-glass hint pills at top: "Flatten pages" · "Good light" · "All text visible"
- Subtle centered message: "Frame the page you read"
- iOS-style shutter button at bottom
- **No confirm page** — tapping shutter goes straight to analysis
- One tap, done

#### 9. Analysis Loading
- CSS stick-figure jogger animation running on a dashed road line
- "Analyzing your reading..." + "This takes a few seconds"
- Auto-advances to results after 3 seconds

#### 10. Results
- Big WCPM number (80px, bold)
- "Words Correct Per Minute" label
- Two stat cells in a strip:
  - Accuracy % (green)
  - Words Correct / Total (e.g., "44 / 47")
- **No "report sent to teacher"** — explicitly removed
- Activities section: Rhythm Remix and Word Maze as list items
- "Done" button returns to student selection

### Key Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Dark theme | Matches existing Rhythm Remix aesthetic; feels mature |
| Passive mic check | No "test your mic" screen — just detect and inform |
| Inline continue button | Reduces visual clutter; action lives next to the selection |
| No confirm page for photo | Every extra tap is friction; OCR can handle imperfect photos |
| No waveform during recording | Distracts the student from reading |
| 60-second timer | Standard ORF assessment window |
| Countdown + beep | Standardizes the start of recording; gives student a clear signal |
| Red dot not red circle for record | Big red circles feel aggressive/intimidating |
| "Start over" appears after 3s | Prevents accidental reset but available if needed |

### What the Student Sees vs. Teacher

**Student sees:**
- WCPM, Accuracy %, Words Correct / Total
- Rhythm Remix (lo-fi playback of their reading)
- Word Maze (comprehension game)

**Teacher receives (not in mockup — separate dashboard):**
- Full dataset: all engine alignments, per-word diagnostics
- AI executive summary explaining patterns
- Word speed map, disfluency analysis, struggle detection
- Historical progress tracking

### Technical Notes

- External mic detection: `navigator.mediaDevices.enumerateDevices()`, filter `kind === 'audioinput'`, check labels for USB/Bluetooth/Wireless/Headset/AirPods keywords
- Beep: Web Audio API, 880Hz sine wave, 300ms duration
- Photo: will use device camera via `<input type="file" accept="image/*" capture="environment">` or `getUserMedia` for live viewfinder
- PWA: needs manifest.json, service worker, responsive design (all device sizes)
- Auth: Google OAuth for teacher account → loads class roster

### Files

- `mockups/mockup-a-mission-control.html` — Round 1 (rejected)
- `mockups/mockup-b-reading-buddy.html` — Round 1 (rejected)
- `mockups/mockup-c-clean-minimal.html` — Round 1 (rejected)
- `mockups/mockup-d-one-flow.html` — Round 2 (predecessor)
- `mockups/mockup-e-feed.html` — Round 2 (not selected)
- `mockups/mockup-f-fullscreen.html` — Round 2 (not selected)
- **`mockups/mockup-d-v2.html`** — Current working design

### Open Questions / Future Work

- Teacher dashboard design (separate effort)
- Offline support / service worker caching strategy
- How to handle failed OCR (blurry photo, bad lighting) — retry flow?
- IndexedDB for local data persistence before sync
- Gemini TTS for countdown voice ("begin reading after the beep") vs. pre-recorded audio
- Whether to show a mini progress chart to students (WCPM over time)
- Accessibility: screen reader support, high contrast mode
- Onboarding flow for first-time users
