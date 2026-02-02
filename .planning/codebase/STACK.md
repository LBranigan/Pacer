# Technology Stack

**Analysis Date:** 2026-02-02

## Languages

**Primary:**
- JavaScript (ES6+) - Browser-based frontend
- HTML5 - Document structure and layout
- CSS3 - Styling and animations

## Runtime

**Environment:**
- Browser (all modern browsers supporting Web APIs: Chrome, Firefox, Safari, Edge)

**Package Manager:**
- None - Single-file application, no npm/yarn dependencies

**Lockfile:**
- Not applicable

## Frameworks

**Core:**
- Vanilla JavaScript - No framework used
- Web APIs only (MediaRecorder, getUserMedia, Fetch API, FileReader)

**Testing:**
- None - No testing framework configured

**Build/Dev:**
- No build tool - Direct HTML file (double-click to run)

## Key Dependencies

**Critical:**
- Google Cloud Speech-to-Text API v1 - Core service for speech-to-text transcription
  - SDK/Client: Browser Fetch API (REST calls only, no SDK)
  - Endpoint: `https://speech.googleapis.com/v1/speech:recognize`
  - Authentication: API key (user-provided, not hardcoded)

**Infrastructure:**
- None - Completely client-side application

## Configuration

**Environment:**
- API key input: User provides GCP API key via HTML form input field
- Reference passage: User provides via textarea input field
- Audio encoding: Auto-detected based on file extension (WAV, FLAC, OGG, MP3, WebM)

**Build:**
- No build configuration - Single .html file
- No bundler or transpiler

## Platform Requirements

**Development:**
- Text editor or IDE
- Modern web browser for local testing
- Google Cloud project with Speech-to-Text API enabled

**Production:**
- Client-side only - No server required
- Works offline after loading except for API calls to Google Cloud
- Deployment: Double-click .html file or serve via HTTP/HTTPS

---

## Audio Input

**Recording:**
- MediaRecorder API with WEBM_OPUS codec
- Browser microphone access via getUserMedia

**File Upload:**
- Supported formats: WAV (LINEAR16), FLAC, OGG (OGG_OPUS), MP3, WebM (WEBM_OPUS)
- Automatic encoding detection based on file extension

## API Specifics

**Google Cloud Speech-to-Text:**
- Model: `latest_long` (for verbatim fidelity and disfluency preservation)
- Enhanced: `true` (uses enhanced model variant)
- Language: `en-US` (hardcoded, configurable for other languages)
- Synchronous endpoint: ~1 minute max audio duration
- Future: Async `longrunningrecognize` endpoint planned for longer passages

---

*Stack analysis: 2026-02-02*
