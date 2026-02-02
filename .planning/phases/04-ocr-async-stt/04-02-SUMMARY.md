# 04-02 Summary: Async STT with Polling and Chunked Fallback

## What was built
- `buildSTTConfig()` helper extracted (DRY across sync/async/chunked)
- `sendToAsyncSTT()`: POSTs to longrunningrecognize, polls every 3s, 5min timeout
- `pollOperation()`: Polls operation status, calls onProgress callback
- `sendChunkedSTT()`: Splits blob into 200KB chunks, sends each to sync endpoint
- Duration routing in app.js: >55s → async path with progress UI, else sync

## Deviations from plan
None — implemented as specified.

## Commits
- 837ff7d feat(04-02): add async STT with polling and chunked sync fallback
