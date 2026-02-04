# Phase 07: Teacher Reporting & Benchmarks - Research

**Researched:** 2026-02-02
**Domain:** Print-ready RTI report generation, Hasbrouck-Tindal ORF benchmark norms
**Confidence:** MEDIUM

## Summary

This phase adds two capabilities to the existing dashboard: (1) generating a printable RTI report for a student, and (2) displaying Hasbrouck-Tindal grade-level benchmark norms alongside student WCPM scores with on-track/at-risk indicators.

Both features are pure frontend work. The RTI report uses CSS `@media print` to create a printer-friendly layout from existing data (no PDF library needed). The benchmark comparison uses a static data table of Hasbrouck-Tindal 2017 compiled ORF norms embedded as a JS module. No new external dependencies are required.

**Primary recommendation:** Use `window.print()` with a dedicated print stylesheet and a static JSON lookup table for Hasbrouck-Tindal norms. No libraries needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| None (vanilla JS) | N/A | Report generation & benchmark display | Matches existing codebase; `window.print()` + CSS print media is the standard browser approach |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None needed | N/A | N/A | N/A |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS @media print | jsPDF / html2pdf.js | Library adds ~200KB; CSS print is sufficient for single-page reports and works offline. Only consider if teachers need programmatic PDF download without print dialog. |
| Static norms JSON | Backend API for norms | Norms are static published data; no reason for a network call |
| Canvas chart snapshot | Re-render chart in report | Use `canvas.toDataURL()` to snapshot the existing celeration chart into the print layout |

**Installation:**
```bash
# No installation needed - vanilla JS + CSS
```

## Architecture Patterns

### Recommended Project Structure
```
js/
├── report.js            # RTI report generation logic
├── benchmarks.js        # Hasbrouck-Tindal norms data + lookup functions
├── storage.js           # (existing) student/assessment data
├── celeration-chart.js  # (existing) chart module
dashboard.html           # (existing) add "Generate Report" button + benchmark indicators
report.html              # New printable report page (opens in new window)
```

### Pattern 1: Print-Optimized Report Page
**What:** A separate `report.html` page designed for printing, opened via `window.open()` from dashboard
**When to use:** When the report layout differs significantly from the interactive dashboard
**Example:**
```javascript
// In dashboard.html - trigger report generation
function generateReport(studentId) {
  localStorage.setItem('orf_report_student', studentId);
  const reportWindow = window.open('report.html', '_blank');
}
```

```css
/* report.html print styles */
@media print {
  @page {
    size: letter portrait;
    margin: 0.75in;
  }
  body { font-size: 11pt; color: #000; }
  .no-print { display: none !important; }
  .page-break { break-before: page; }
  table { break-inside: avoid; }
  h2 { break-after: avoid; }
}
```

### Pattern 2: Canvas-to-Image for Print
**What:** Snapshot the celeration chart canvas as a PNG data URL and embed it as an `<img>` in the report
**When to use:** Including the trend chart in a printed report
**Example:**
```javascript
// Capture chart as image for report
const chartImage = document.getElementById('celerationCanvas').toDataURL('image/png');
// In report page:
const img = document.createElement('img');
img.src = chartImage;
img.style.width = '100%';
reportChartContainer.appendChild(img);
```

### Pattern 3: Static Benchmark Lookup
**What:** Hasbrouck-Tindal norms stored as a plain JS object, with a lookup function that returns percentile-based risk category
**When to use:** Comparing any student WCPM to grade-level norms
**Example:**
```javascript
// benchmarks.js
export const HT_NORMS = {
  // grade -> season -> { p10, p25, p50, p75, p90 }
  1: {
    winter: { p10: 12, p25: 28, p50: 53, p75: 82, p90: 111 },
    spring: { p10: 28, p25: 46, p50: 72, p75: 100, p90: 126 }
  },
  2: {
    fall:   { p10: 25, p25: 44, p50: 72, p75: 100, p90: 124 },
    winter: { p10: 42, p25: 64, p50: 89, p75: 114, p90: 136 },
    spring: { p10: 55, p25: 78, p50: 104, p75: 127, p90: 148 }
  },
  3: {
    fall:   { p10: 44, p25: 66, p50: 93, p75: 120, p90: 146 },
    winter: { p10: 61, p25: 82, p50: 108, p75: 133, p90: 157 },
    spring: { p10: 69, p25: 91, p50: 118, p75: 143, p90: 166 }
  },
  4: {
    fall:   { p10: 65, p25: 87, p50: 113, p75: 139, p90: 165 },
    winter: { p10: 74, p25: 98, p50: 125, p75: 152, p90: 177 },
    spring: { p10: 83, p25: 105, p50: 133, p75: 160, p90: 185 }
  },
  5: {
    fall:   { p10: 75, p25: 99, p50: 126, p75: 153, p90: 179 },
    winter: { p10: 84, p25: 109, p50: 136, p75: 163, p90: 189 },
    spring: { p10: 90, p25: 115, p50: 144, p75: 171, p90: 197 }
  },
  6: {
    fall:   { p10: 82, p25: 107, p50: 136, p75: 164, p90: 190 },
    winter: { p10: 89, p25: 115, p50: 145, p75: 173, p90: 199 },
    spring: { p10: 96, p25: 122, p50: 150, p75: 177, p90: 204 }
  }
};

export function getBenchmarkStatus(wcpm, grade, season) {
  const norms = HT_NORMS[grade]?.[season];
  if (!norms) return { status: 'unknown', label: 'No norms available' };
  if (wcpm >= norms.p50) return { status: 'on-track', label: 'On Track', color: '#2e7d32' };
  if (wcpm >= norms.p25) return { status: 'some-risk', label: 'Some Risk', color: '#f57f17' };
  return { status: 'at-risk', label: 'At Risk', color: '#c62828' };
}
```

### Anti-Patterns to Avoid
- **Generating PDF client-side with a library:** Unnecessary complexity for this use case; CSS print handles it
- **Hardcoding norms inline:** Keep norms in a separate module for maintainability and easy correction
- **Re-implementing the chart for print:** Use `canvas.toDataURL()` instead of redrawing

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF generation | Custom PDF builder | `window.print()` + CSS `@media print` | Browser print-to-PDF is reliable; no library overhead |
| Chart in report | Redraw chart on report page | `canvas.toDataURL('image/png')` | One line vs. reimplementing entire chart |
| Date formatting | Custom date formatter | `Date.toLocaleDateString('en-US', options)` | Browser-native, locale-aware |
| Table layout for print | Manual positioning | HTML `<table>` with `break-inside: avoid` | Tables print predictably with CSS page break rules |

**Key insight:** This phase is fundamentally a data presentation task. All the data already exists in localStorage. The work is layout and formatting, not computation.

## Common Pitfalls

### Pitfall 1: Canvas Blank in Print
**What goes wrong:** `canvas.toDataURL()` returns blank if called before the chart finishes rendering
**Why it happens:** Canvas rendering is synchronous but the chart module may use requestAnimationFrame
**How to avoid:** Call `chart.redraw()` synchronously, then immediately call `toDataURL()`. Or capture the data URL when navigating to report page, pass via localStorage.
**Warning signs:** Blank rectangle where chart should be in printed report

### Pitfall 2: Print Styles Not Applied
**What goes wrong:** Report looks like the screen version when printed
**Why it happens:** Missing `@media print` block or specificity issues with existing styles
**How to avoid:** Use a dedicated report.html with its own styles, not dashboard.html with print overrides. Test with Chrome DevTools "Emulate CSS media type: print"
**Warning signs:** Navigation elements, buttons visible in print preview

### Pitfall 3: Student Grade Level Not Stored
**What goes wrong:** Cannot look up Hasbrouck-Tindal norms without knowing the student's grade
**Why it happens:** Current student profile only stores `{ id, name, createdAt }` -- no grade field
**How to avoid:** Add a `grade` field to the student profile. Must update the student creation UI and storage.js. Migration needed for existing data (default to null, prompt teacher to set).
**Warning signs:** Benchmark section shows "No norms available" for all students

### Pitfall 4: Season Detection
**What goes wrong:** Incorrect benchmark comparison because wrong season norms are used
**Why it happens:** Hasbrouck-Tindal norms are season-specific (fall/winter/spring). Assessment date must map to the correct season.
**How to avoid:** Use simple date ranges: Fall = Aug-Nov, Winter = Dec-Feb, Spring = Mar-Jul. Derive from assessment date automatically.
**Warning signs:** Student shows "at risk" in fall but norms used are spring norms

### Pitfall 5: Norms Data Accuracy
**What goes wrong:** Incorrect WCPM thresholds lead to wrong risk classifications
**Why it happens:** Hasbrouck-Tindal 2017 norms are published in a specific technical report; transcription errors are possible
**How to avoid:** Cross-reference norms values against the original source (Technical Report #1702). The values in the Code Examples section above are from training data and should be verified against the published table before shipping.
**Warning signs:** Teachers report benchmark indicators don't match their printed norm charts

## Code Examples

### RTI Report HTML Structure
```html
<!-- report.html skeleton -->
<div class="report-header">
  <h1>Oral Reading Fluency Report</h1>
  <div class="report-meta">
    <span>Student: <strong id="rptStudentName"></strong></span>
    <span>Grade: <strong id="rptGrade"></strong></span>
    <span>Report Date: <strong id="rptDate"></strong></span>
  </div>
</div>

<div class="report-section">
  <h2>Trend Summary</h2>
  <img id="rptChartImage" alt="Student progress chart" />
  <table class="report-summary-table">
    <tr><th>Metric</th><th>Latest</th><th>Previous</th><th>Change</th></tr>
    <tr><td>WCPM</td><td id="rptWcpm"></td><td id="rptPrevWcpm"></td><td id="rptWcpmChange"></td></tr>
    <tr><td>Accuracy</td><td id="rptAcc"></td><td id="rptPrevAcc"></td><td id="rptAccChange"></td></tr>
  </table>
</div>

<div class="report-section">
  <h2>Benchmark Comparison</h2>
  <div id="rptBenchmark"></div>
</div>

<div class="report-section">
  <h2>Error Analysis</h2>
  <div id="rptErrors"></div>
</div>

<div class="report-section">
  <h2>Assessment History</h2>
  <table id="rptHistory"></table>
</div>

<button class="no-print" onclick="window.print()">Print Report</button>
```

### Benchmark Display with Visual Indicator
```javascript
// Render benchmark comparison for dashboard
function renderBenchmarkIndicator(container, wcpm, grade, season) {
  const { status, label, color } = getBenchmarkStatus(wcpm, grade, season);
  const norms = HT_NORMS[grade]?.[season];
  if (!norms) {
    container.innerHTML = '<span class="benchmark-na">Set student grade to see benchmarks</span>';
    return;
  }

  container.innerHTML = `
    <div class="benchmark-bar">
      <div class="benchmark-zone at-risk" style="width:${(norms.p25/norms.p90)*100}%"></div>
      <div class="benchmark-zone some-risk" style="width:${((norms.p50-norms.p25)/norms.p90)*100}%"></div>
      <div class="benchmark-zone on-track" style="width:${((norms.p90-norms.p50)/norms.p90)*100}%"></div>
      <div class="benchmark-marker" style="left:${Math.min(100, (wcpm/norms.p90)*100)}%"></div>
    </div>
    <div class="benchmark-label" style="color:${color}">${label} (${wcpm} WCPM, 50th %ile = ${norms.p50})</div>
  `;
}
```

### Season Detection from Date
```javascript
export function getSeason(date) {
  const month = new Date(date).getMonth(); // 0-indexed
  if (month >= 7 && month <= 10) return 'fall';    // Aug-Nov
  if (month >= 11 || month <= 1) return 'winter';  // Dec-Feb
  return 'spring';                                   // Mar-Jul
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side PDF libraries (jsPDF) | CSS @media print + window.print() | Ongoing trend | Simpler, no dependencies, browser handles pagination |
| Hasbrouck-Tindal 2006 norms | Hasbrouck-Tindal 2017 norms (Technical Report #1702) | 2017 | Updated from 3 data sources (DIBELS, DIBELS Next, easyCBM); larger sample; grades 1-6 only (2006 had 1-8) |

**Deprecated/outdated:**
- Hasbrouck-Tindal 2006 norms: Superseded by 2017 update with larger sample sizes
- Grade 7-8 norms: The 2017 update only covers grades 1-6 (the 2006 version covered 1-8)

## Open Questions

1. **Hasbrouck-Tindal norms exact values**
   - What we know: The 2017 norms exist for grades 1-6, fall/winter/spring, percentiles 10/25/50/75/90. Values in this document are from training data.
   - What's unclear: Whether the exact WCPM values listed above are 100% accurate (could not fetch the PDF or data table directly)
   - Recommendation: Before shipping, manually verify the norms table against the published source: Hasbrouck & Tindal (2017) Technical Report #1702, available at [Reading Rockets](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update) or [ERIC ED594994](https://files.eric.ed.gov/fulltext/ED594994.pdf). **Confidence: LOW for exact numbers.**

2. **Student grade level storage**
   - What we know: Current student model is `{ id, name, createdAt }` with no grade field
   - What's unclear: Whether to require grade at student creation or allow setting it later
   - Recommendation: Add optional `grade` field to student profile. Show a prompt/dropdown in the dashboard when grade is missing and benchmarks are requested. Requires a storage migration (v2 -> v3).

3. **Report scope for RTI meetings**
   - What we know: RTI reports typically include trend data, current performance vs. benchmarks, error patterns, and intervention recommendations
   - What's unclear: Exact RTI report format preferences vary by district
   - Recommendation: Provide a general-purpose report with the data available. Don't attempt to auto-generate intervention recommendations (out of scope per REQUIREMENTS.md).

## Sources

### Primary (HIGH confidence)
- Existing codebase: `dashboard.html`, `js/storage.js`, `js/celeration-chart.js` - reviewed directly
- CSS @media print: [MDN Printing Guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing)
- Canvas toDataURL: standard Web API, well-documented

### Secondary (MEDIUM confidence)
- Hasbrouck-Tindal 2017 norms existence and structure: Confirmed via multiple sources ([Reading Rockets](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update), [Read Naturally](https://www.readnaturally.com/article/hasbrouck-tindal-oral-reading-fluency-data-2017), [ERIC](https://files.eric.ed.gov/fulltext/ED594994.pdf))
- CSS print best practices: [Smashing Magazine](https://www.smashingmagazine.com/2018/05/print-stylesheets-in-2018/), [SitePoint](https://www.sitepoint.com/css-printer-friendly-pages/)

### Tertiary (LOW confidence)
- Exact WCPM values in the norms table: From training data only; PDF could not be parsed. Must be verified manually.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No libraries needed; vanilla JS + CSS print is the established approach
- Architecture: HIGH - Pattern is straightforward (separate report page, static norms module, canvas snapshot)
- Pitfalls: HIGH - Well-known issues with print CSS and canvas; grade field gap identified from code review
- Norms data accuracy: LOW - Exact numbers need manual verification against published source

**Research date:** 2026-02-02
**Valid until:** Indefinite (norms are static published data; CSS print is stable)
