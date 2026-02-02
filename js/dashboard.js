/**
 * Dashboard launcher — opens dashboard in a new window.
 * @module dashboard
 * @exports {Function} initDashboard
 */

export function initDashboard() {
  let dashboardWindow = null;

  function show(studentId) {
    if (!studentId) return;
    // Store studentId where the popup can read it reliably
    localStorage.setItem('orf_dashboard_student', studentId);
    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.close();
    }
    dashboardWindow = window.open('dashboard.html', '_blank', 'width=1100,height=800');
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
