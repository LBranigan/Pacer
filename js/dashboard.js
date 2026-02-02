/**
 * Dashboard launcher — opens dashboard in a new window.
 * @module dashboard
 * @exports {Function} initDashboard
 */

export function initDashboard() {
  let dashboardWindow = null;

  function show(studentId) {
    if (!studentId) return;
    const url = 'dashboard.html?student=' + encodeURIComponent(studentId);
    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.location.href = url;
      dashboardWindow.focus();
    } else {
      dashboardWindow = window.open(url, 'dashboard', 'width=1100,height=800');
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
