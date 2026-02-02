/**
 * Standard Celeration Chart - ES Module
 * Ported from standalone Standard Celeration Chart dashboard.
 * Renders a 6-cycle semi-logarithmic grid on a canvas element.
 *
 * @module celeration-chart
 * @exports {Function} createChart
 */

// ===== Default Configuration =====
const DEFAULT_CONFIG = Object.freeze({
    // Standard Celeration Chart Y-axis range (logarithmic)
    yMin: 0.001,
    yMax: 1000,

    // X-axis range (calendar days)
    xMin: 0,
    xMax: 140,

    // Chart margins
    margin: { top: 60, right: 80, bottom: 60, left: 80 },

    // Grid lines for log scale (count per minute values)
    // Original SCC is 6-cycle semi-log paper with lines at 1-9 within each decade
    logGridLines: [
        // Decade 0.001
        0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009,
        // Decade 0.01
        0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09,
        // Decade 0.1
        0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
        // Decade 1
        1, 2, 3, 4, 5, 6, 7, 8, 9,
        // Decade 10
        10, 20, 30, 40, 50, 60, 70, 80, 90,
        // Decade 100
        100, 200, 300, 400, 500, 600, 700, 800, 900,
        // Top
        1000
    ],
    // Major lines are at powers of 10 (decade markers)
    majorLogLines: [0.001, 0.01, 0.1, 1, 10, 100, 1000],
    // Mid-decade lines for labels
    midLogLines: [0.005, 0.05, 0.5, 5, 50, 500],

    // Week markers
    weekDays: 7,

    // Zoom presets (in days)
    zoomLevels: {
        7:   { label: '1 Week',   days: 7,   weekInterval: 1, dayInterval: 1 },
        30:  { label: '1 Month',  days: 30,  weekInterval: 1, dayInterval: 7 },
        90:  { label: '3 Months', days: 90,  weekInterval: 2, dayInterval: 14 },
        140: { label: 'Full',     days: 140, weekInterval: 4, dayInterval: 14 }
    },

    // Vintage Scientific Instrument color palette
    colors: {
        paperCream: '#f7f3eb',
        paperAged: '#efe9dd',
        inkNavy: '#1a2744',
        inkLight: '#2d3d5a',
        burgundy: '#8b2942',
        brass: '#c4a35a',
        gridMajor: 'rgba(26, 39, 68, 0.35)',
        gridMinor: 'rgba(26, 39, 68, 0.12)',
        gridAccent: 'rgba(139, 41, 66, 0.2)',
        // Original SCC cyan color scheme
        sccCyan: '#00a0b0',
        sccGridMajor: 'rgba(0, 160, 176, 0.6)',
        sccGridMid: 'rgba(0, 160, 176, 0.4)',
        sccGridMinor: 'rgba(0, 160, 176, 0.25)'
    },

    // Colors for multiple students (vintage-appropriate)
    studentColors: [
        '#2d6a4f', // forest green
        '#b07d3d', // bronze
        '#4a6fa5', // slate blue
        '#7b5ea7', // purple
        '#9d4444', // brick red
        '#3d7a7a', // teal
        '#8b6914', // olive gold
        '#6b4c7a'  // dusty violet
    ],

    // Metric colors - sepia-tinted for vintage feel
    metricColors: {
        correctPerMinute: '#2d6a4f',
        errorsPerMinute: '#9d4444',
        wpm: '#4a6fa5',
        accuracy: '#7b5ea7',
        prosody: '#b07d3d'
    },

    // Data point symbols
    symbols: {
        correct: 'dot',
        errors: 'x',
        zero: '?'
    }
});

// ===== Metric Labels =====
const METRIC_LABELS = {
    correctPerMinute: 'Correct/min',
    errorsPerMinute: 'Errors/min',
    wpm: 'Words/min',
    accuracy: 'Accuracy %',
    prosody: 'Prosody'
};

/**
 * Create a Standard Celeration Chart on the given canvas element.
 *
 * @param {HTMLCanvasElement} canvasEl - The canvas to draw on.
 * @param {Object} [options={}] - Override any DEFAULT_CONFIG values.
 * @returns {Object} Chart API: setData, setMetrics, setZoom, pan, toggleCelerationLines, destroy.
 */
export function createChart(canvasEl, options = {}) {
    // Merge config
    const config = {
        ...DEFAULT_CONFIG,
        ...options,
        margin: { ...DEFAULT_CONFIG.margin, ...(options.margin || {}) },
        colors: { ...DEFAULT_CONFIG.colors, ...(options.colors || {}) },
        metricColors: { ...DEFAULT_CONFIG.metricColors, ...(options.metricColors || {}) },
        zoomLevels: { ...DEFAULT_CONFIG.zoomLevels, ...(options.zoomLevels || {}) }
    };

    // Internal state -- fully encapsulated
    const state = {
        students: [],
        activeStudents: new Set(),
        activeMetrics: { correctPerMinute: true, errorsPerMinute: true },
        displayOptions: {
            showCelerationLines: true,
            showGrid: true,
            showTooltips: true,
            showDataPoints: true,
            connectPoints: true
        },
        zoom: 140,
        panOffset: 0,
        maxDataDay: 140,
        canvas: canvasEl,
        ctx: canvasEl.getContext('2d'),
        hoveredPoint: null
    };

    // ----- Coordinate Transforms -----

    function valueToY(value, chartHeight) {
        const { yMin, yMax } = config;
        value = Math.max(yMin, Math.min(yMax, value));
        const logMin = Math.log10(yMin);
        const logMax = Math.log10(yMax);
        const logValue = Math.log10(value);
        const normalized = (logValue - logMin) / (logMax - logMin);
        return chartHeight * (1 - normalized);
    }

    function dayToX(normalizedDay, chartWidth, xMax, panOffset) {
        return ((normalizedDay - panOffset) / xMax) * chartWidth;
    }

    // ----- Canvas Sizing -----

    function resizeCanvas() {
        const wrapper = state.canvas.parentElement;
        if (!wrapper) return;
        const dpr = window.devicePixelRatio || 1;
        state.canvas.width = wrapper.clientWidth * dpr;
        state.canvas.height = wrapper.clientHeight * dpr;
        state.canvas.style.width = wrapper.clientWidth + 'px';
        state.canvas.style.height = wrapper.clientHeight + 'px';
        state.ctx.scale(dpr, dpr);
    }

    // ----- Zoom / Pan Helpers -----

    function getZoomConfig() {
        return config.zoomLevels[state.zoom] || config.zoomLevels[140];
    }

    function getPanStep() {
        if (state.zoom <= 7) return 1;
        if (state.zoom <= 30) return 7;
        if (state.zoom <= 90) return 14;
        return 30;
    }

    function updateMaxDataDay() {
        let maxDay = 140;
        state.students.forEach(student => {
            if (student.assessments) {
                student.assessments.forEach(a => {
                    if (a.celeration && a.celeration.calendarDay) {
                        maxDay = Math.max(maxDay, a.celeration.calendarDay);
                    }
                });
            }
        });
        state.maxDataDay = Math.max(140, Math.ceil((maxDay + 7) / 7) * 7);
    }

    // ----- Data Extraction -----

    function getDataPoints(student, metric) {
        return student.assessments
            .filter(a => a.celeration)
            .map(a => {
                let value;
                switch (metric) {
                    case 'correctPerMinute':
                        value = a.celeration.correctPerMinute || 0; break;
                    case 'errorsPerMinute':
                        value = a.celeration.errorsPerMinute || 0; break;
                    case 'wpm':
                        value = a.performance?.wpm || 0; break;
                    case 'accuracy':
                        value = a.performance?.accuracy || 0; break;
                    case 'prosody':
                        value = (a.prosody?.score || 0) * 20; break;
                    default:
                        value = 0;
                }
                return {
                    day: a.celeration.calendarDay,
                    value,
                    countingTimeMin: a.celeration.countingTimeMin,
                    date: a.celeration.date,
                    assessment: a
                };
            })
            .sort((a, b) => a.day - b.day);
    }

    // ----- Celeration Math -----

    function calculateCeleration(dataPoints) {
        if (dataPoints.length < 2) return 1;
        const validPoints = dataPoints.filter(p => p.value > 0);
        if (validPoints.length < 2) return 1;

        const logPoints = validPoints.map(p => ({ x: p.day, y: Math.log10(p.value) }));
        const n = logPoints.length;
        const sumX  = logPoints.reduce((s, p) => s + p.x, 0);
        const sumY  = logPoints.reduce((s, p) => s + p.y, 0);
        const sumXY = logPoints.reduce((s, p) => s + p.x * p.y, 0);
        const sumX2 = logPoints.reduce((s, p) => s + p.x * p.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return Math.pow(10, slope * 7);
    }

    function formatCeleration(value) {
        if (!isFinite(value) || isNaN(value)) return 'N/A';
        return value >= 1 ? `x${value.toFixed(2)}` : `/${(1 / value).toFixed(2)}`;
    }

    // ----- Pattern Detection -----

    function detectPatterns() {
        const patterns = [];
        state.activeStudents.forEach(studentId => {
            const student = state.students.find(s => s.id === studentId);
            if (!student || !student.assessments) return;
            const correctData = student.assessments
                .filter(a => a.celeration && a.celeration.correctPerMinute > 0)
                .map(a => ({ day: a.celeration.calendarDay, value: a.celeration.correctPerMinute, date: a.celeration.date }))
                .sort((a, b) => a.day - b.day);
            patterns.push(...detectConsecutiveDeclines(correctData, student.name));
        });
        return patterns;
    }

    function detectConsecutiveDeclines(dataPoints, studentName) {
        const patterns = [];
        if (dataPoints.length < 2) return patterns;
        let consecutiveDeclines = 0;
        let declineStartDay = null;
        let declineEndDay = null;

        for (let i = 1; i < dataPoints.length; i++) {
            if (dataPoints[i].value < dataPoints[i - 1].value) {
                if (consecutiveDeclines === 0) declineStartDay = dataPoints[i - 1].day;
                consecutiveDeclines++;
                declineEndDay = dataPoints[i].day;
            } else {
                if (consecutiveDeclines >= 2) {
                    patterns.push({
                        type: 'decline',
                        severity: consecutiveDeclines >= 3 ? 'critical' : 'warning',
                        studentName, consecutiveDays: consecutiveDeclines,
                        startDay: declineStartDay, endDay: declineEndDay,
                        metric: 'Correct/Min'
                    });
                }
                consecutiveDeclines = 0;
                declineStartDay = null;
            }
        }
        if (consecutiveDeclines >= 2) {
            patterns.push({
                type: 'decline',
                severity: consecutiveDeclines >= 3 ? 'critical' : 'warning',
                studentName, consecutiveDays: consecutiveDeclines,
                startDay: declineStartDay, endDay: declineEndDay,
                metric: 'Correct/Min'
            });
        }
        return patterns;
    }

    // ----- Drawing Functions -----

    function drawChart() {
        const { ctx, canvas } = state;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) return;

        const { margin } = config;
        const zoomConfig = getZoomConfig();
        const xMax = state.zoom;

        ctx.clearRect(0, 0, width, height);

        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        // Background
        ctx.fillStyle = config.colors.paperCream;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(margin.left, margin.top);

        if (state.displayOptions.showGrid) {
            drawGrid(ctx, chartWidth, chartHeight, xMax, zoomConfig);
        }
        drawAxes(ctx, chartWidth, chartHeight, xMax, zoomConfig);

        // Draw data for each active student and metric
        state.activeStudents.forEach(studentId => {
            const student = state.students.find(s => s.id === studentId);
            if (!student) return;
            const activeMetricKeys = Object.keys(state.activeMetrics).filter(k => state.activeMetrics[k]);
            activeMetricKeys.forEach(metric => {
                drawDataSeries(ctx, student, metric, chartWidth, chartHeight, xMax);
            });
        });

        ctx.restore();

        drawAxisLabels(ctx, width, height, margin);
    }

    function drawGrid(ctx, width, height, xMax, zoomConfig) {
        const panOffset = state.panOffset;

        // Vertical grid lines (calendar days)
        ctx.strokeStyle = config.colors.sccGridMinor;
        ctx.lineWidth = 1;
        const dayInterval = zoomConfig.dayInterval;
        for (let day = 0; day <= xMax; day += dayInterval) {
            const x = (day / xMax) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Week number labels at top
        ctx.fillStyle = config.colors.sccCyan;
        ctx.font = '300 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const weekInterval = zoomConfig.weekInterval;
        const startWeek = Math.floor(panOffset / 7);
        const maxWeeks = Math.ceil((panOffset + xMax) / 7);
        for (let week = startWeek; week <= maxWeeks; week += weekInterval) {
            const dayInView = (week * 7) - panOffset;
            const x = (dayInView / xMax) * width;
            if (x >= 0 && x <= width) {
                ctx.fillText(week.toString(), x, -8);
            }
        }

        // Horizontal grid lines (logarithmic)
        config.logGridLines.forEach(value => {
            const y = valueToY(value, height);
            const isMajor = config.majorLogLines.includes(value);
            const isMid = config.midLogLines.includes(value);

            if (isMajor) {
                ctx.strokeStyle = config.colors.sccGridMajor;
                ctx.lineWidth = 1.5;
            } else if (isMid) {
                ctx.strokeStyle = config.colors.sccGridMid;
                ctx.lineWidth = 1;
            } else {
                ctx.strokeStyle = config.colors.sccGridMinor;
                ctx.lineWidth = 0.5;
            }

            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        });
    }

    function drawAxes(ctx, width, height, xMax, zoomConfig) {
        ctx.fillStyle = config.colors.sccCyan;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const formatYLabel = (value) => {
            if (value >= 1) return value.toString();
            return '.' + value.toString().split('.')[1];
        };

        // Major lines labels
        ctx.font = '300 13px Inter, sans-serif';
        config.majorLogLines.forEach(value => {
            const y = valueToY(value, height);
            ctx.fillText(formatYLabel(value), -8, y);
        });

        // Mid-decade labels
        ctx.font = '300 10px Inter, sans-serif';
        config.midLogLines.forEach(value => {
            const y = valueToY(value, height);
            ctx.fillText(formatYLabel(value), -8, y);
        });

        // X-axis labels
        ctx.fillStyle = config.colors.sccCyan;
        ctx.font = '300 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const dayIntervalX = zoomConfig.dayInterval;
        const panOffset = state.panOffset;
        for (let day = 0; day <= xMax; day += dayIntervalX) {
            const x = (day / xMax) * width;
            const actualDay = day + panOffset;
            ctx.fillText(actualDay.toString(), x, height + 10);
        }
    }

    function drawAxisLabels(ctx, width, height, margin) {
        // Y-axis label (rotated)
        ctx.save();
        ctx.fillStyle = config.colors.sccCyan;
        ctx.font = '400 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.translate(18, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('COUNT PER MINUTE', 0, 0);
        ctx.restore();

        // Week label at top
        ctx.fillStyle = config.colors.sccCyan;
        ctx.font = '400 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SUCCESSIVE CALENDAR WEEKS', width / 2, 18);
    }

    function drawDataSeries(ctx, student, metric, chartWidth, chartHeight, xMax) {
        const color = config.metricColors[metric];
        const dataPoints = getDataPoints(student, metric);
        const panOffset = state.panOffset;

        if (dataPoints.length === 0) return;

        const minDay = Math.min(...dataPoints.map(p => p.day));
        const normalizedPoints = dataPoints.map(p => ({ ...p, normalizedDay: p.day - minDay }));

        const visiblePoints = normalizedPoints.filter(p =>
            p.normalizedDay >= panOffset && p.normalizedDay <= panOffset + xMax
        );
        const pointsForCeleration = normalizedPoints.filter(p => p.normalizedDay <= panOffset + xMax);

        const dtx = (nd) => dayToX(nd, chartWidth, xMax, panOffset);

        // Draw connecting lines
        if (state.displayOptions.connectPoints && visiblePoints.length > 1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            let started = false;
            visiblePoints.forEach(point => {
                if (point.value <= 0) return;
                const x = dtx(point.normalizedDay);
                const y = valueToY(point.value, chartHeight);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else { ctx.lineTo(x, y); }
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Draw celeration line
        if (state.displayOptions.showCelerationLines && pointsForCeleration.length >= 2) {
            const validPoints = pointsForCeleration.filter(p => p.value > 0);
            if (validPoints.length >= 2) {
                drawCelerationLine(ctx, validPoints, color, chartWidth, chartHeight, xMax, metric, panOffset);
            }
        }

        // Draw data points
        if (state.displayOptions.showDataPoints) {
            visiblePoints.forEach(point => {
                const x = dtx(point.normalizedDay);
                const y = valueToY(point.value > 0 ? point.value : 0.0005, chartHeight);
                if (metric === 'errorsPerMinute') {
                    drawXMark(ctx, x, y, 6, color);
                } else if (point.value === 0) {
                    drawQuestionMark(ctx, x, y, color);
                } else {
                    drawDot(ctx, x, y, 5, color);
                }
            });
        }
    }

    function drawDot(ctx, x, y, radius, color) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0a1628';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawXMark(ctx, x, y, size, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - size, y - size);
        ctx.lineTo(x + size, y + size);
        ctx.moveTo(x + size, y - size);
        ctx.lineTo(x - size, y + size);
        ctx.stroke();
    }

    function drawQuestionMark(ctx, x, y, color) {
        ctx.fillStyle = color;
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y);
    }

    function drawCelerationLine(ctx, points, color, chartWidth, chartHeight, xMax, metric, panOffset) {
        const logPoints = points.map(p => ({ x: p.normalizedDay, y: Math.log10(p.value) }));
        const n = logPoints.length;
        const sumX  = logPoints.reduce((s, p) => s + p.x, 0);
        const sumY  = logPoints.reduce((s, p) => s + p.y, 0);
        const sumXY = logPoints.reduce((s, p) => s + p.x * p.y, 0);
        const sumX2 = logPoints.reduce((s, p) => s + p.x * p.x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        const weeklyCeleration = Math.pow(10, slope * 7);

        const dtx = (day) => ((day - panOffset) / xMax) * chartWidth;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.globalAlpha = 0.8;

        const minX = Math.min(...points.map(p => p.normalizedDay));
        const maxX = Math.max(...points.map(p => p.normalizedDay));
        const extendDays = Math.min(3, xMax * 0.1);
        const startX = Math.max(panOffset, minX - extendDays);
        const endX = Math.min(panOffset + xMax, maxX + extendDays);

        const startY = Math.pow(10, intercept + slope * startX);
        const endY = Math.pow(10, intercept + slope * endX);

        ctx.beginPath();
        ctx.moveTo(dtx(startX), valueToY(startY, chartHeight));
        ctx.lineTo(dtx(endX), valueToY(endY, chartHeight));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Draw celeration label
        if (isFinite(weeklyCeleration) && !isNaN(weeklyCeleration)) {
            const celerationLabel = formatCeleration(weeklyCeleration);
            const labelX = dtx(endX);
            const labelY = valueToY(endY, chartHeight);

            ctx.font = "600 11px 'IBM Plex Mono', monospace";
            const textWidth = ctx.measureText(celerationLabel).width;
            const padding = 4;

            ctx.fillStyle = config.colors.inkNavy;
            ctx.fillRect(labelX + 5, labelY - 8, textWidth + padding * 2, 16);

            ctx.strokeStyle = config.colors.brass;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(labelX + 5, labelY - 8, textWidth + padding * 2, 16);

            ctx.fillStyle = config.colors.paperCream;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(celerationLabel, labelX + 5 + padding, labelY);

            if (metric === 'correctPerMinute') {
                const targetLabel = '(goal: x2.0)';
                ctx.font = "500 9px 'IBM Plex Mono', monospace";
                ctx.fillStyle = config.colors.brass;
                ctx.fillText(targetLabel, labelX + 5 + padding, labelY + 12);
            }
        }
    }

    // ----- Tooltip Handling -----

    function handleMouseMove(e) {
        if (!state.displayOptions.showTooltips) return;

        const rect = state.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left - config.margin.left;
        const y = e.clientY - rect.top - config.margin.top;

        const chartWidth = state.canvas.clientWidth - config.margin.left - config.margin.right;
        const chartHeight = state.canvas.clientHeight - config.margin.top - config.margin.bottom;
        const xMax = state.zoom;
        const panOffset = state.panOffset;

        if (x < 0 || x > chartWidth || y < 0 || y > chartHeight) {
            hideTooltip();
            return;
        }

        let closestPoint = null;
        let closestDist = Infinity;

        state.activeStudents.forEach(studentId => {
            const student = state.students.find(s => s.id === studentId);
            if (!student) return;

            const activeMetricKeys = Object.keys(state.activeMetrics).filter(k => state.activeMetrics[k]);
            activeMetricKeys.forEach(metric => {
                const dataPoints = getDataPoints(student, metric);
                const minDay = dataPoints.length > 0 ? Math.min(...dataPoints.map(p => p.day)) : 0;

                dataPoints.forEach(point => {
                    if (point.value <= 0) return;
                    const normalizedDay = point.day - minDay;
                    if (normalizedDay < panOffset || normalizedDay > panOffset + xMax) return;

                    const px = ((normalizedDay - panOffset) / xMax) * chartWidth;
                    const py = valueToY(point.value, chartHeight);
                    const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);

                    if (dist < closestDist && dist < 20) {
                        closestDist = dist;
                        closestPoint = { student, metric, point, x: px, y: py };
                    }
                });
            });
        });

        if (closestPoint) {
            showTooltip(closestPoint);
        } else {
            hideTooltip();
        }
    }

    // Tooltip element -- lazily created as a child of canvas parent
    let tooltipEl = null;

    function ensureTooltip() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = 'position:absolute;pointer-events:none;background:#1a2744;color:#f7f3eb;' +
            'padding:8px 12px;border-radius:6px;font-size:12px;font-family:Inter,sans-serif;' +
            'opacity:0;transition:opacity 0.15s;z-index:100;white-space:nowrap;border:1px solid #c4a35a;';
        const parent = state.canvas.parentElement || document.body;
        parent.style.position = parent.style.position || 'relative';
        parent.appendChild(tooltipEl);
        return tooltipEl;
    }

    function showTooltip(info) {
        const tip = ensureTooltip();
        const metricLabel = METRIC_LABELS[info.metric] || info.metric;
        let html = `<strong>${escapeHtml(info.student.name)}</strong><br>`;
        if (info.point.date) html += `Date: ${info.point.date}<br>`;
        html += `Day: ${info.point.day}<br>`;
        html += `${metricLabel}: ${info.point.value.toFixed(2)}`;
        if (info.point.countingTimeMin) {
            html += `<br>Timing: ${(info.point.countingTimeMin * 60).toFixed(0)}s`;
        }
        tip.innerHTML = html;
        tip.style.left = (info.x + config.margin.left + 15) + 'px';
        tip.style.top = (info.y + config.margin.top - 10) + 'px';
        tip.style.opacity = '1';
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.style.opacity = '0';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ----- Event Wiring -----

    const resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
        drawChart();
    });

    function onMouseLeave() { hideTooltip(); }

    // Initialize
    resizeCanvas();
    drawChart();
    resizeObserver.observe(canvasEl.parentElement || canvasEl);
    canvasEl.addEventListener('mousemove', handleMouseMove);
    canvasEl.addEventListener('mouseleave', onMouseLeave);

    // ----- Public API -----

    return {
        /**
         * Load student data and render.
         * @param {Array<{name:string, id:string, assessments:Array}>} students
         */
        setData(students) {
            state.students = students;
            state.activeStudents = new Set(students.map(s => s.id));
            updateMaxDataDay();
            drawChart();
        },

        /**
         * Toggle which metrics are displayed.
         * @param {{correctPerMinute?:boolean, errorsPerMinute?:boolean, wpm?:boolean, accuracy?:boolean, prosody?:boolean}} metrics
         */
        setMetrics(metrics) {
            state.activeMetrics = { ...state.activeMetrics, ...metrics };
            drawChart();
        },

        /**
         * Set zoom level to one of 7, 30, 90, 140 days.
         * @param {number} days
         */
        setZoom(days) {
            state.zoom = days;
            const maxOffset = Math.max(0, state.maxDataDay - state.zoom);
            state.panOffset = Math.min(state.panOffset, maxOffset);
            drawChart();
        },

        /**
         * Pan left or right.
         * @param {'left'|'right'} direction
         */
        pan(direction) {
            const step = getPanStep();
            const delta = direction === 'left' ? -step : step;
            const newOffset = state.panOffset + delta;
            const maxOffset = Math.max(0, state.maxDataDay - state.zoom);
            state.panOffset = Math.max(0, Math.min(maxOffset, newOffset));
            drawChart();
        },

        /**
         * Toggle celeration line overlay.
         * @param {boolean} show
         */
        toggleCelerationLines(show) {
            state.displayOptions.showCelerationLines = show;
            drawChart();
        },

        /**
         * Get detected patterns for currently active students.
         * @returns {Array}
         */
        getPatterns() {
            return detectPatterns();
        },

        /**
         * Force a redraw.
         */
        redraw() {
            drawChart();
        },

        /**
         * Clean up all event listeners and observers.
         */
        destroy() {
            resizeObserver.disconnect();
            canvasEl.removeEventListener('mousemove', handleMouseMove);
            canvasEl.removeEventListener('mouseleave', onMouseLeave);
            if (tooltipEl && tooltipEl.parentElement) {
                tooltipEl.parentElement.removeChild(tooltipEl);
            }
            tooltipEl = null;
        }
    };
}
