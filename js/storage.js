// storage.js – localStorage CRUD for students and assessments
// Single key: orf_data  { version, students[], assessments[] }

const STORAGE_KEY = 'orf_data';

function defaultData() {
  return { version: 1, students: [], assessments: [] };
}

function migrate(data) {
  // Future migrations go here based on data.version
  if (!data.version) data.version = 1;
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.assessments)) data.assessments = [];
  return data;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    return migrate(data);
  } catch {
    return defaultData();
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Exported API ──

export function getStudents() {
  return load().students;
}

export function addStudent(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const data = load();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const student = { id, name: trimmed, createdAt: new Date().toISOString() };
  data.students.push(student);
  save(data);
  return student;
}

export function deleteStudent(id) {
  const data = load();
  data.students = data.students.filter(s => s.id !== id);
  data.assessments = data.assessments.filter(a => a.studentId !== id);
  save(data);
}

export function saveAssessment(studentId, results) {
  if (!studentId || !results) return null;
  const data = load();
  const assessment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    studentId,
    date: new Date().toISOString(),
    wcpm: results.wcpm ?? null,
    accuracy: results.accuracy ?? null,
    totalWords: results.totalWords ?? null,
    errors: results.errors ?? null,
    duration: results.duration ?? null,
    passagePreview: results.passagePreview ?? null
  };
  data.assessments.push(assessment);
  save(data);
  return assessment;
}

export function getAssessments(studentId) {
  return load().assessments.filter(a => a.studentId === studentId);
}
