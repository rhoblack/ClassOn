// 실시간 피드백 API 라우터
// 버튼 세트 관리, 피드백 현황 조회

const express = require('express');
const router = express.Router();
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

router.use(requireAuth);

// ─────────────────────────────────────────
// GET /api/feedback/:courseId/current
// 현재 교실 전체 학생의 최신 피드백 상태
// ─────────────────────────────────────────
router.get('/feedback/:courseId/current', (req, res) => {
  const { courseId } = req.params;

  // 마지막 전체 초기화 시각 조회
  const lastClear = db.prepare(`
    SELECT MAX(cleared_at) as cleared_at FROM feedback_clears WHERE course_id = ?
  `).get(courseId);
  const clearedAt = lastClear && lastClear.cleared_at;

  // 각 학생의 오늘 가장 최근 피드백 (전체 초기화 이후 것만)
  const feedbacks = db.prepare(`
    SELECT
      e.id as enrollment_id,
      s.name,
      e.seat_no,
      fl.button_set_id,
      fl.color,
      fl.emoji,
      fl.label,
      fl.created_at
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    LEFT JOIN (
      SELECT enrollment_id, button_set_id, color, emoji, label, created_at,
        ROW_NUMBER() OVER (PARTITION BY enrollment_id ORDER BY created_at DESC) as rn
      FROM feedback_logs
      WHERE DATE(created_at) = DATE('now','localtime')
        ${clearedAt ? `AND created_at > '${clearedAt}'` : ''}
    ) fl ON fl.enrollment_id = e.id AND fl.rn = 1
    WHERE e.course_id = ?
    ORDER BY s.name
  `).all(courseId);

  res.json({ success: true, data: feedbacks });
});

// ─────────────────────────────────────────
// GET /api/feedback/:courseId/stats
// 현재 피드백 통계 (버튼별 집계)
// ─────────────────────────────────────────
router.get('/feedback/:courseId/stats', (req, res) => {
  const { courseId } = req.params;

  // 오늘의 가장 최근 피드백 기준 집계
  const stats = db.prepare(`
    WITH latest_feedback AS (
      SELECT enrollment_id, label, color, emoji,
        ROW_NUMBER() OVER (PARTITION BY enrollment_id ORDER BY created_at DESC) as rn
      FROM feedback_logs
      WHERE DATE(created_at) = DATE('now','localtime')
        AND enrollment_id IN (SELECT id FROM enrollments WHERE course_id = ?)
    )
    SELECT label, color, emoji, COUNT(*) as count
    FROM latest_feedback
    WHERE rn = 1
    GROUP BY label, color, emoji
    ORDER BY count DESC
  `).all(courseId);

  const total = db.prepare(`
    SELECT COUNT(*) as cnt FROM enrollments WHERE course_id = ?
  `).get(courseId).cnt;

  res.json({ success: true, data: { stats, total } });
});

// ─────────────────────────────────────────
// GET /api/feedback/:courseId/history
// 최근 피드백 로그 이력
// ─────────────────────────────────────────
router.get('/feedback/:courseId/history', (req, res) => {
  const { courseId } = req.params;
  const { limit = 50 } = req.query;

  const logs = db.prepare(`
    SELECT fl.*, s.name
    FROM feedback_logs fl
    JOIN enrollments e ON e.id = fl.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE e.course_id = ?
    ORDER BY fl.created_at DESC
    LIMIT ?
  `).all(courseId, parseInt(limit));

  res.json({ success: true, data: logs });
});

// ─────────────────────────────────────────
// GET /api/feedback/:courseId/questions
// 질문 목록 (학생 이름 포함)
// ─────────────────────────────────────────
router.get('/feedback/:courseId/questions', (req, res) => {
  const questions = db.prepare(`
    SELECT q.id, q.text, q.is_checked, q.created_at, s.name AS student_name
    FROM questions_anon q
    JOIN enrollments e ON e.id = q.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE q.course_id = ?
    ORDER BY q.created_at DESC
  `).all(req.params.courseId);

  res.json({ success: true, data: questions });
});

// ─────────────────────────────────────────
// PUT /api/feedback/questions/:id/check
// 익명 질문 확인 처리
// ─────────────────────────────────────────
router.put('/feedback/questions/:id/check', (req, res) => {
  db.prepare('UPDATE questions_anon SET is_checked = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// GET /api/feedback/:courseId/help-requests
// 도움 요청 대기열
// ─────────────────────────────────────────
router.get('/feedback/:courseId/help-requests', (req, res) => {
  const requests = db.prepare(`
    SELECT hr.id, hr.enrollment_id, hr.status, hr.created_at, s.name
    FROM help_requests hr
    JOIN enrollments e ON e.id = hr.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE hr.course_id = ? AND hr.status = 'waiting'
    ORDER BY hr.created_at ASC
  `).all(req.params.courseId);

  res.json({ success: true, data: requests });
});

// ─────────────────────────────────────────
// PUT /api/feedback/help-requests/:id/done
// 도움 요청 처리 완료
// ─────────────────────────────────────────
router.put('/feedback/help-requests/:id/done', (req, res) => {
  db.prepare("UPDATE help_requests SET status = 'done' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// GET /api/button-sets — 버튼 세트 목록
// ─────────────────────────────────────────
router.get('/button-sets', (req, res) => {
  const { course_id } = req.query;

  // 전역 기본 세트 + 해당 과정 세트
  const sets = db.prepare(`
    SELECT * FROM button_sets
    WHERE course_id IS NULL OR course_id = ?
    ORDER BY is_default DESC, created_at ASC
  `).all(course_id || 0);

  // buttons JSON 파싱
  const parsed = sets.map(s => ({
    ...s,
    buttons: JSON.parse(s.buttons),
  }));

  res.json({ success: true, data: parsed });
});

// ─────────────────────────────────────────
// POST /api/button-sets — 버튼 세트 생성
// ─────────────────────────────────────────
router.post('/button-sets', (req, res) => {
  const { course_id, name, style, buttons } = req.body;

  if (!name || !buttons || !Array.isArray(buttons) || buttons.length < 2) {
    return res.status(400).json({ success: false, message: '세트명과 버튼(2개 이상)은 필수입니다.' });
  }
  if (buttons.length > 5) {
    return res.status(400).json({ success: false, message: '버튼은 최대 5개입니다.' });
  }

  const result = db.prepare(`
    INSERT INTO button_sets (course_id, name, style, buttons)
    VALUES (?, ?, ?, ?)
  `).run(course_id || null, name, style || 'emoji', JSON.stringify(buttons));

  const set = db.prepare('SELECT * FROM button_sets WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: { ...set, buttons: JSON.parse(set.buttons) } });
});

// ─────────────────────────────────────────
// PUT /api/button-sets/:id — 버튼 세트 수정
// ─────────────────────────────────────────
router.put('/button-sets/:id', (req, res) => {
  const { name, style, buttons } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM button_sets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '버튼 세트를 찾을 수 없습니다.' });

  // 기본 세트는 수정 불가
  if (existing.is_default) {
    return res.status(403).json({ success: false, message: '기본 세트는 수정할 수 없습니다.' });
  }

  db.prepare(`
    UPDATE button_sets SET
      name = COALESCE(?, name),
      style = COALESCE(?, style),
      buttons = COALESCE(?, buttons)
    WHERE id = ?
  `).run(name || null, style || null, buttons ? JSON.stringify(buttons) : null, id);

  const set = db.prepare('SELECT * FROM button_sets WHERE id = ?').get(id);
  res.json({ success: true, data: { ...set, buttons: JSON.parse(set.buttons) } });
});

// ─────────────────────────────────────────
// DELETE /api/button-sets/:id — 버튼 세트 삭제
// ─────────────────────────────────────────
router.delete('/button-sets/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM button_sets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: '버튼 세트를 찾을 수 없습니다.' });
  if (existing.is_default) {
    return res.status(403).json({ success: false, message: '기본 세트는 삭제할 수 없습니다.' });
  }

  db.prepare('DELETE FROM button_sets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
