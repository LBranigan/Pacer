export function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

export function displayResults(data) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';

  if (!data.results || data.results.length === 0) {
    wordsDiv.textContent = 'No speech detected.';
    return;
  }

  const allWords = [];
  const plainParts = [];

  data.results.forEach(result => {
    const alt = result.alternatives[0];
    if (!alt) return;
    plainParts.push(alt.transcript);
    if (alt.words) {
      alt.words.forEach(w => {
        allWords.push(w);
        const span = document.createElement('span');
        span.className = 'word ' + (w.confidence >= 0.9 ? 'high' : w.confidence >= 0.7 ? 'mid' : 'low');
        const start = parseFloat(w.startTime?.replace('s','')) || 0;
        const end = parseFloat(w.endTime?.replace('s','')) || 0;
        span.title = `Confidence: ${(w.confidence * 100).toFixed(1)}%  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s`;
        span.textContent = w.word;
        wordsDiv.appendChild(span);
        wordsDiv.appendChild(document.createTextNode(' '));
      });
    }
  });

  plainDiv.textContent = plainParts.join(' ');

  // Collect alternatives for display
  const altTranscripts = [];
  data.results.forEach(result => {
    if (result.alternatives && result.alternatives.length > 1) {
      for (let i = 1; i < result.alternatives.length; i++) {
        altTranscripts.push(result.alternatives[i].transcript);
      }
    }
  });

  const jsonOutput = { words: allWords };
  if (altTranscripts.length > 0) jsonOutput.alternativeTranscripts = altTranscripts;
  jsonDiv.textContent = JSON.stringify(jsonOutput, null, 2);
}

/**
 * Display color-coded alignment results with metrics.
 * @param {Array<{ref: string|null, hyp: string|null, type: string}>} alignment
 * @param {{wcpm: number, correctCount: number, elapsedSeconds: number}|null} wcpm
 * @param {{accuracy: number, correctCount: number, totalRefWords: number, substitutions: number, omissions: number, insertions: number}} accuracy
 */
export function displayAlignmentResults(alignment, wcpm, accuracy) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';

  // Metrics summary bar
  const metricsBar = document.createElement('div');
  metricsBar.className = 'metrics-bar';

  const wcpmBox = document.createElement('div');
  wcpmBox.className = 'metric-box';
  wcpmBox.innerHTML = '<span class="metric-value">' + (wcpm ? wcpm.wcpm : 'N/A') + '</span><span class="metric-label">WCPM</span>';
  metricsBar.appendChild(wcpmBox);

  const accBox = document.createElement('div');
  accBox.className = 'metric-box';
  accBox.innerHTML = '<span class="metric-value">' + accuracy.accuracy + '%</span><span class="metric-label">Accuracy</span>';
  metricsBar.appendChild(accBox);

  const errBox = document.createElement('div');
  errBox.className = 'metric-box metric-box-errors';
  errBox.innerHTML = '<span class="metric-label">' +
    accuracy.substitutions + ' substitutions, ' +
    accuracy.omissions + ' omissions, ' +
    accuracy.insertions + ' insertions</span>';
  metricsBar.appendChild(errBox);

  plainDiv.appendChild(metricsBar);

  // Render reference words color-coded
  const insertions = [];
  for (const item of alignment) {
    if (item.type === 'insertion') {
      insertions.push(item);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'word word-' + item.type;
    span.textContent = item.ref || '';
    if (item.type === 'substitution') {
      span.title = 'Expected: ' + item.ref + ', Said: ' + item.hyp;
    } else if (item.type === 'omission') {
      span.title = 'Omitted (not read)';
    }
    wordsDiv.appendChild(span);
    wordsDiv.appendChild(document.createTextNode(' '));
  }

  // Insertions section
  if (insertions.length > 0) {
    const insertSection = document.createElement('div');
    insertSection.style.marginTop = '1rem';
    const insertLabel = document.createElement('div');
    insertLabel.style.fontWeight = '600';
    insertLabel.style.marginBottom = '0.25rem';
    insertLabel.textContent = 'Inserted words (not in passage):';
    insertSection.appendChild(insertLabel);
    for (const ins of insertions) {
      const span = document.createElement('span');
      span.className = 'word word-insertion';
      span.textContent = ins.hyp;
      insertSection.appendChild(span);
      insertSection.appendChild(document.createTextNode(' '));
    }
    wordsDiv.appendChild(insertSection);
  }

  // JSON details
  jsonDiv.textContent = JSON.stringify({ alignment, wcpm, accuracy }, null, 2);
}
