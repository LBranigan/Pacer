# Phase 12 Plan 04: VAD Calibration System Summary

---
phase: 12-vad-integration
plan: 04
subsystem: audio-processing
tags: [vad, calibration, ui, microphone, silero]
---

## One-liner

Microphone calibration with 2s ambient noise recording, noise-floor-based threshold (0.15-0.60), preset buttons (Quiet Room/Normal/Noisy), and settings UI.

## Dependency Graph

**Requires:**
- 12-01: VADProcessor class with setThreshold(), ONNX/Silero setup

**Provides:**
- calibrateMicrophone() function in VADProcessor
- VAD settings UI section in index.html
- UI wiring for calibration, slider, and presets

**Affects:**
- 12-02: Ghost detection will use calibrated threshold
- 12-03: Ghost flagging UI may display calibration status

## Tech Tracking

**Added:**
- MediaRecorder API for calibration recording
- NonRealTimeVAD for noise floor analysis

**Patterns:**
- Noise floor estimation via false-positive detection during silence
- Session-only settings (no persistence per CONTEXT.md)

## File Tracking

**Created:**
- None (all modifications to existing files)

**Modified:**
- js/vad-processor.js: +111 lines (calibrateMicrophone, getCalibrationStatus, noiseLevel/isCalibrated properties)
- js/app.js: +68 lines (vadProcessor import, VAD settings UI wiring)
- index.html: +19 lines (VAD settings section with calibrate button, slider, presets)
- style.css: +12 lines (VAD settings CSS)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 2s calibration duration | Per CONTEXT.md specification |
| Noise classification: Low/Moderate/High | Based on noise ratio and segment count during silence |
| Threshold values: 0.20/0.35/0.50 | Match preset buttons and provide meaningful spread |
| No threshold persistence | Per CONTEXT.md: "Reset each session" |
| MediaRecorder over AudioWorklet | Simpler for one-time 2s recording, no need for real-time streaming |

## Metrics

**Duration:** 2 minutes
**Completed:** 2026-02-03
**Tasks:** 3/3

## Commits

| Hash | Message |
|------|---------|
| 239ead9 | feat(12-04): add calibrateMicrophone() to VADProcessor |
| 9b76890 | feat(12-04): add VAD settings section to index.html |
| 070ed36 | feat(12-04): wire up VAD settings UI in app.js |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:
- [x] Calibrate button records 2 seconds of ambient audio
- [x] Calibration result shows threshold (0.15-0.60) and noise level (Low/Moderate/High)
- [x] Noise level display format: "Noise Level: Low (0.23)"
- [x] Slider allows manual threshold adjustment 0.15-0.60
- [x] Preset buttons (Quiet Room/Normal/Noisy) set common threshold values
- [x] Calibration overrides manual settings
- [x] High noise shows subtle guidance note
- [x] Threshold resets to 0.375 on page reload
- [x] VAD settings in settings area, not visible during assessment

## Next Phase Readiness

**Ready for 12-02:** Ghost detection logic can now use the calibrated threshold from vadProcessor.getThreshold().

**Remaining in Phase 12:**
- 12-02: Ghost detection logic (compare STT words against VAD segments)
- 12-03: Ghost flagging UI (visual indicators for flagged words)
