/**
 * Dashboard launcher — opens dashboard in a new window.
 * @module dashboard
 * @exports {Function} initDashboard
 */

export function initDashboard() {
  let dashboardWindow = null;

  function show(studentId) {
    if (!studentId) return;
    // Store studentId where the popup can read it
    localStorage.setItem('orf_dashboard_student', studentId);

    // Build absolute URL to dashboard.html relative to current page
    const base = window.location.href.replace(/[^/]*$/, '');
    const url = base + 'dashboard.html';

    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.location.href = url;
      dashboardWindow.focus();
    } else {
      dashboardWindow = window.open(url, 'orf_dashboard', 'width=1100,height=800');
    }
  }

  function hide() {
    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.close();
    }
    dashboardWindow = null;
  }

  function isVisible() {
    return dashboardWindow != null && !dashboardWindow.closed;
  }

  return { show, hide, isVisible };
}
