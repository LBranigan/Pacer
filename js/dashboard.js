/**
 * Dashboard view controller with celeration chart integration and error display.
 * @module dashboard
 * @exports {Function} initDashboard
 */

import { createChart } from './celeration-chart.js';
import { createSyncedPlayback } from './audio-playback.js';

/**
 * Initialize the dashboard controller.
 * @param {Function} getAssessmentsFn - (studentId) => assessments[]
 * @param {Function} getStudentsFn - () => students[]
 * @returns {{ show(studentId: string): void, hide(): void, isVisible(): boolean }}
 */
export function initDashboard(getAssessmentsFn, getStudentsFn) {
  let chart = null;
  let currentStudentId = null;
  let playback = null;
  const dashboardSection = document.getElementById('dashboardSection');
  const historySection = document.getElementById('historySection');
  const canvas = document.getElementById('celerationCanvas');
  const assessmentList = document.getElementById('dashboardAssessments');
  const errorBreakdown = document.getElementById('errorBreakdown');

  // Zoom buttons
  const zoomBtns = dashboardSection.querySelectorAll('[data-zoom]');
  zoomBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (chart) chart.setZoom(parseInt(btn.dataset.zoom, 10));
      zoomBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Metric toggles
  const metricToggles = dashboardSection.querySelectorAll('[data-metric]');
  metricToggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
      if (chart) {
        const metrics = {};
        metrics[toggle.dataset.metric] = toggle.checked;
        chart.setMetrics(metrics);
      }
    });
  });

  // Celeration line toggle
  const celToggle = document.getElementById('celerationLineToggle');
  if (celToggle) {
    celToggle.addEventListener('change', () => {
      if (chart) chart.toggleCelerationLines(celToggle.checked);
    });
  }

  // Back button
  const backBtn = document.getElementById('dashboardBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => hide());
  }

  function toChartData(assessments, studentName, studentId) {
    if (!assessments || assessments.length === 0) return [];
    const sorted = [...assessments].sort((a, b) => new Date(a.date) - new Date(b.date));
    const firstDate = new Date(sorted[0].date).getTime();

    const transformed = sorted.map(a => {
      const calendarDay = Math.floor((new Date(a.date).getTime() - firstDate) / 86400000);
      const correctPerMinute = a.wcpm || 0;
      const errorsPerMinute = (a.duration && a.duration > 0)
        ? (a.errors || 0) / (a.duration / 60)
        : 0;
      return { calendarDay, correctPerMinute, errorsPerMinute };
    });

    return [{ name: studentName, id: studentId, assessments: transformed }];
  }

  function renderAssessmentCards(assessments) {
    assessmentList.innerHTML = '';
    if (!assessments || assessments.length === 0) {
      assessmentList.innerHTML = '<p class="dashboard-empty">No assessments yet.</p>';
      return;
    }

    const sorted = [...assessments].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const a of sorted) {
      const card = document.createElement('div');
      card.className = 'assessment-card';
      card.dataset.id = a.id;

      const date = new Date(a.date).toLocaleDateString();
      const wcpm = a.wcpm != null ? a.wcpm : 'N/A';
      const acc = a.accuracy != null ? a.accuracy + '%' : 'N/A';
      const subs = a.errorBreakdown ? a.errorBreakdown.substitutions : '?';
      const omit = a.errorBreakdown ? a.errorBreakdown.omissions : '?';
      const ins = a.errorBreakdown ? a.errorBreakdown.insertions : '?';

      card.innerHTML =
        `<div class="card-header">` +
          `<span class="card-date">${date}</span>` +
          `<span class="card-wcpm">${wcpm} WCPM</span>` +
        `</div>` +
        `<div class="card-stats">` +
          `<span>Accuracy: ${acc}</span>` +
          `<span class="card-errors">S:${subs} O:${omit} I:${ins}</span>` +
        `</div>`;

      card.addEventListener('click', () => {
        assessmentList.querySelectorAll('.assessment-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        renderErrorBreakdown(a);
      });

      assessmentList.appendChild(card);
    }
  }

  function renderErrorBreakdown(assessment) {
    errorBreakdown.innerHTML = '';

    if (!assessment.errorBreakdown || !assessment.errorBreakdown.details) {
      errorBreakdown.innerHTML = '<p class="error-detail">Detailed breakdown not available for this assessment.</p>';
      return;
    }

    const eb = assessment.errorBreakdown;
    const details = eb.details || [];

    // Substitutions
    const subs = details.filter(d => d.type === 'substitution');
    if (subs.length > 0) {
      const section = document.createElement('div');
      section.className = 'error-section error-substitutions';
      section.innerHTML = `<h4>Substitutions (${eb.substitutions})</h4>`;
      const table = document.createElement('table');
      table.innerHTML = '<tr><th>Expected</th><th></th><th>Spoke</th></tr>';
      for (const s of subs) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${esc(s.ref)}</td><td class="arrow">&rarr;</td><td>${esc(s.hyp)}</td>`;
        table.appendChild(row);
      }
      section.appendChild(table);
      errorBreakdown.appendChild(section);
    }

    // Omissions
    const omissions = details.filter(d => d.type === 'omission');
    if (omissions.length > 0) {
      const section = document.createElement('div');
      section.className = 'error-section error-omissions';
      section.innerHTML = `<h4>Omissions (${eb.omissions})</h4>`;
      const list = document.createElement('ul');
      for (const o of omissions) {
        const li = document.createElement('li');
        li.textContent = o.ref;
        list.appendChild(li);
      }
      section.appendChild(list);
      errorBreakdown.appendChild(section);
    }

    // Insertions
    const insertions = details.filter(d => d.type === 'insertion');
    if (insertions.length > 0) {
      const section = document.createElement('div');
      section.className = 'error-section error-insertions';
      section.innerHTML = `<h4>Insertions (${eb.insertions})</h4>`;
      const list = document.createElement('ul');
      for (const i of insertions) {
        const li = document.createElement('li');
        li.textContent = i.hyp;
        list.appendChild(li);
      }
      section.appendChild(list);
      errorBreakdown.appendChild(section);
    }

    if (subs.length === 0 && omissions.length === 0 && insertions.length === 0) {
      errorBreakdown.innerHTML = '<p class="error-detail">No errors in this assessment.</p>';
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function show(studentId) {
    currentStudentId = studentId;
    dashboardSection.style.display = 'block';
    historySection.style.display = 'none';

    const assessments = getAssessmentsFn(studentId);
    const students = getStudentsFn();
    const student = students.find(s => s.id === studentId);
    const studentName = student ? student.name : 'Student';

    // Render chart
    if (chart) {
      chart.destroy();
      chart = null;
    }

    if (assessments.length > 0) {
      chart = createChart(canvas);
      const chartData = toChartData(assessments, studentName, studentId);
      chart.setData(chartData);
    }

    // Render assessment cards
    renderAssessmentCards(assessments);

    // Clear error breakdown
    errorBreakdown.innerHTML = '<p class="error-detail">Click an assessment to see error details.</p>';
  }

  function hide() {
    dashboardSection.style.display = 'none';
    historySection.style.display = 'block';
    destroyPlayback();
    if (chart) {
      chart.destroy();
      chart = null;
    }
    currentStudentId = null;
  }

  function isVisible() {
    return dashboardSection.style.display !== 'none';
  }

  return { show, hide, isVisible };
}
