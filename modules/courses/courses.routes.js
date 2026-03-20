// 과정(코호트) 관리 API 라우터

const express = require('express');
const router = express.Router();
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

// 모든 API는 강사 인증 필요
router.use(requireAuth);

// ─────────────────────────────────────────
// GET /api/courses — 전체 과정 목록
// ─────────────────────────────────────────
router.get('/courses', (req, res) => {
  const courses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
    FROM courses c
    ORDER BY c.created_at DESC
  `).all();

  res.json({ success: true, data: courses });
});

// ─────────────────────────────────────────
// GET /api/courses/:id — 과정 단건
// ─────────────────────────────────────────
router.get('/courses/:id', (req, res) => {
  const course = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
    FROM courses c WHERE c.id = ?
  `).get(req.params.id);

  if (!course) return res.status(404).json({ success: false, message: '과정을 찾을 수 없습니다.' });
  res.json({ success: true, data: course });
});

// ─────────────────────────────────────────
// POST /api/courses — 과정 생성
// ─────────────────────────────────────────
router.post('/courses', (req, res) => {
  const { name, cohort, start_date, end_date } = req.body;

  if (!name || !cohort) {
    return res.status(400).json({ success: false, message: '과정명과 기수는 필수입니다.' });
  }

  const result = db.prepare(`
    INSERT INTO courses (name, cohort, start_date, end_date)
    VALUES (?, ?, ?, ?)
  `).run(name, cohort, start_date || null, end_date || null);

  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: course });
});

// ─────────────────────────────────────────
// PUT /api/courses/:id — 과정 수정
// ─────────────────────────────────────────
router.put('/courses/:id', (req, res) => {
  const { name, cohort, start_date, end_date, status } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '과정을 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE courses
    SET name = COALESCE(?, name),
        cohort = COALESCE(?, cohort),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        status = COALESCE(?, status)
    WHERE id = ?
  `).run(name || null, cohort || null, start_date || null, end_date || null, status || null, id);

  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  res.json({ success: true, data: course });
});

// ─────────────────────────────────────────
// DELETE /api/courses/:id — 과정 삭제
// ─────────────────────────────────────────
router.delete('/courses/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '과정을 찾을 수 없습니다.' });

  // 트랜잭션으로 관련 데이터 모두 삭제
  const deleteFunc = db.transaction(() => {
    // 해당 과정의 모든 enrollments 조회
    const enrollmentIds = db.prepare('SELECT id FROM enrollments WHERE course_id = ?').all(id).map(e => e.id);

    // enrollments에 연결된 데이터 삭제
    if (enrollmentIds.length > 0) {
      const placeholders = enrollmentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM attendance WHERE enrollment_id IN (${placeholders})`).run(...enrollmentIds);
      db.prepare(`DELETE FROM feedback_logs WHERE enrollment_id IN (${placeholders})`).run(...enrollmentIds);
      db.prepare(`DELETE FROM questions_anon WHERE enrollment_id IN (${placeholders})`).run(...enrollmentIds);
      db.prepare(`DELETE FROM help_requests WHERE enrollment_id IN (${placeholders})`).run(...enrollmentIds);
      db.prepare(`DELETE FROM quiz_answers WHERE enrollment_id IN (${placeholders})`).run(...enrollmentIds);
    }

    // 과정 관련 데이터 삭제
    db.prepare('DELETE FROM button_sets WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM layouts WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM quizzes WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM quiz_sessions WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM questions WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM teams WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM feedback_clears WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(id);

    // 마지막으로 과정 삭제
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  });

  deleteFunc();
  res.json({ success: true });
});

// ─────────────────────────────────────────
// POST /api/courses/:id/activate — 오늘 수업 과정 지정
// ─────────────────────────────────────────
router.post('/courses/:id/activate', (req, res) => {
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '과정을 찾을 수 없습니다.' });

  // 기존 is_today 해제
  db.prepare('UPDATE courses SET is_today = 0').run();
  // 선택 과정 활성화
  db.prepare('UPDATE courses SET is_today = 1 WHERE id = ?').run(id);

  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  res.json({ success: true, data: course });
});


module.exports = router;
