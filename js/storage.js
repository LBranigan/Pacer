// storage.js – localStorage CRUD for students and assessments
// Single key: orf_data  { version, students[], assessments[] }

import { deleteAudioBlobsForStudent } from './audio-store.js';

const STORAGE_KEY = 'orf_data';

function defaultData() {
  return { version: 5, students: [], assessments: [] };
}

function migrate(data) {
  if (!data.version) data.version = 1;
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.assessments)) data.assessments = [];

  // v1 -> v2: add enriched assessment fields
  if (data.version === 1) {
    for (const a of data.assessments) {
      if (a.errorBreakdown === undefined) a.errorBreakdown = null;
      if (a.alignment === undefined) a.alignment = null;
      if (a.sttWords === undefined) a.sttWords = null;
      if (a.audioRef === undefined) a.audioRef = null;
    }
    data.version = 2;
  }

  // v2 -> v3: add grade field to students
  if (data.version === 2) {
    for (const s of data.students) {
      s.grade = s.grade || null;
    }
    data.version = 3;
  }

  // v3 -> v4: add gamification field to assessments
  if (data.version === 3) {
    for (const a of data.assessments) {
      if (a.gamification === undefined) a.gamification = null;
    }
    data.version = 4;
  }

  // v4 -> v5: add nlAnnotations field to assessments
  if (data.version === 4) {
    for (const a of data.assessments) {
      if (a.nlAnnotations === undefined) a.nlAnnotations = null;
    }
    data.version = 5;
  }

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

export function addStudent(name, grade = null) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const data = load();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const student = { id, name: trimmed, grade: grade, createdAt: new Date().toISOString() };
  data.students.push(student);
  save(data);
  return student;
}

export function updateStudentGrade(studentId, grade) {
  const data = load();
  const student = data.students.find(s => s.id === studentId);
  if (!student) return null;
  student.grade = (grade >= 1 && grade <= 12) ? grade : null;
  save(data);
  return student;
}

export async function deleteStudent(id) {
  const data = load();
  const assessmentIds = data.assessments
    .filter(a => a.studentId === id)
    .map(a => a.id);
  await deleteAudioBlobsForStudent(assessmentIds);
  data.students = data.students.filter(s => s.id !== id);
  data.assessments = data.assessments.filter(a => a.studentId !== id);
  save(data);
}

export function saveAssessment(studentId, results) {
  if (!studentId || !results) return null;
  const data = load();
  const assessment = {
    id: results._id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    studentId,
    date: new Date().toISOString(),
    wcpm: results.wcpm ?? null,
    accuracy: results.accuracy ?? null,
    totalWords: results.totalWords ?? null,
    errors: results.errors ?? null,
    duration: results.duration ?? null,
    passagePreview: results.passagePreview ?? null,
    errorBreakdown: results.errorBreakdown ?? null,
    alignment: results.alignment ?? null,
    sttWords: results.sttWords ?? null,
    audioRef: results.audioRef ?? null,
    gamification: results.gamification ?? null,
    nlAnnotations: results.nlAnnotations ?? null
  };
  data.assessments.push(assessment);
  save(data);
  return assessment;
}

export function getAssessments(studentId) {
  return load().assessments.filter(a => a.studentId === studentId);
}

export function getAssessment(assessmentId) {
  return load().assessments.find(a => a.id === assessmentId) || null;
}

export function saveGamification(assessmentId, scoreData) {
  const data = load();
  const assessment = data.assessments.find(a => a.id === assessmentId);
  if (!assessment) return null;
  assessment.gamification = scoreData;
  save(data);
  return assessment;
}
