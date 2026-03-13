// 퀴즈 & 성취도 API 라우터

const express = require('express');
const router = express.Router();
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

router.use(requireAuth);

// ─────────────────────────────────────────
// GET /api/quizzes — 퀴즈 목록 (과정별)
// ─────────────────────────────────────────
router.get('/quizzes', (req, res) => {
  const { course_id } = req.query;

  const quizzes = db.prepare(`
    SELECT * FROM quizzes
    WHERE course_id = ? OR course_id IS NULL
    ORDER BY created_at DESC
  `).all(course_id || null);

  const parsed = quizzes.map(q => ({
    ...q,
    options: q.options ? JSON.parse(q.options) : null,
  }));

  res.json({ success: true, data: parsed });
});

// ─────────────────────────────────────────
// POST /api/quizzes — 퀴즈 생성
// ─────────────────────────────────────────
router.post('/quizzes', (req, res) => {
  const { course_id, title, type, question, options, answer, explanation, time_limit, source } = req.body;

  if (!type || !question || !answer) {
    return res.status(400).json({ success: false, message: '유형, 문제, 정답은 필수입니다.' });
  }

  if (type === '4choice' && (!options || options.length !== 4)) {
    return res.status(400).json({ success: false, message: '4지선다는 보기 4개가 필요합니다.' });
  }

  const result = db.prepare(`
    INSERT INTO quizzes (course_id, title, type, question, options, answer, explanation, time_limit, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    course_id || null, title || null, type, question,
    options ? JSON.stringify(options) : null,
    answer, explanation || '', time_limit || 30, source || 'instant'
  );

  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: { ...quiz, options: quiz.options ? JSON.parse(quiz.options) : null } });
});

// ─────────────────────────────────────────
// PUT /api/quizzes/:id — 퀴즈 수정
// ─────────────────────────────────────────
router.put('/quizzes/:id', (req, res) => {
  const { title, question, options, answer, explanation, time_limit } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '퀴즈를 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE quizzes SET
      title = COALESCE(?, title),
      question = COALESCE(?, question),
      options = COALESCE(?, options),
      answer = COALESCE(?, answer),
      explanation = COALESCE(?, explanation),
      time_limit = COALESCE(?, time_limit)
    WHERE id = ?
  `).run(title||null, question||null, options?JSON.stringify(options):null, answer||null, explanation||null, time_limit||null, id);

  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
  res.json({ success: true, data: { ...quiz, options: quiz.options ? JSON.parse(quiz.options) : null } });
});

// ─────────────────────────────────────────
// DELETE /api/quizzes/:id — 퀴즈 삭제
// ─────────────────────────────────────────
router.delete('/quizzes/:id', (req, res) => {
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// POST /api/quiz-sessions — 퀴즈 세션 시작
// ─────────────────────────────────────────
router.post('/quiz-sessions', (req, res) => {
  const { quiz_id, course_id } = req.body;

  if (!quiz_id || !course_id) {
    return res.status(400).json({ success: false, message: '퀴즈ID와 과정ID는 필수입니다.' });
  }

  // 기존 활성 세션 종료 (배치 모드에서는 생략 — 모든 세션이 active 상태를 유지해야 응답 수집 가능)
  if (!req.body.suppress_socket) {
    db.prepare(`
      UPDATE quiz_sessions SET status = 'ended', ended_at = datetime('now','localtime')
      WHERE course_id = ? AND status = 'active'
    `).run(course_id);
  }

  // 새 세션 생성
  const result = db.prepare(`
    INSERT INTO quiz_sessions (quiz_id, course_id) VALUES (?, ?)
  `).run(quiz_id, course_id);

  const session = db.prepare(`
    SELECT qs.*, q.type, q.question, q.options, q.time_limit
    FROM quiz_sessions qs
    JOIN quizzes q ON q.id = qs.quiz_id
    WHERE qs.id = ?
  `).get(result.lastInsertRowid);

  // 학생에게는 정답 제외하고 전달
  const quizForStudent = {
    sessionId: session.id,
    type: session.type,
    question: session.question,
    options: session.options ? JSON.parse(session.options) : null,
    timeLimit: session.time_limit,
  };

  // Socket.io로 학생에게 퀴즈 전달 (suppress_socket=true이면 생략)
  const io = req.app.get('io');
  if (io && !req.body.suppress_socket) {
    io.to(`course:${course_id}`).emit('student:quiz-start', quizForStudent);
  }

  res.json({ success: true, data: { ...session, options: session.options ? JSON.parse(session.options) : null } });
});

// ─────────────────────────────────────────
// PUT /api/quiz-sessions/:id — 퀴즈 세션 종료
// ─────────────────────────────────────────
router.put('/quiz-sessions/:id', (req, res) => {
  const { id } = req.params;

  const session = db.prepare('SELECT * FROM quiz_sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE quiz_sessions SET status = 'ended', ended_at = datetime('now','localtime')
    WHERE id = ?
  `).run(id);

  // 학생에게 퀴즈 종료 알림
  const io = req.app.get('io');
  if (io) {
    io.to(`course:${session.course_id}`).emit('student:quiz-end', { sessionId: id });
  }

  res.json({ success: true });
});

// ─────────────────────────────────────────
// GET /api/quiz-sessions/:id/results — 퀴즈 결과
// ─────────────────────────────────────────
router.get('/quiz-sessions/:id/results', (req, res) => {
  const { id } = req.params;

  const session = db.prepare(`
    SELECT qs.*, q.answer as correct_answer, q.type, q.question, q.options
    FROM quiz_sessions qs
    JOIN quizzes q ON q.id = qs.quiz_id
    WHERE qs.id = ?
  `).get(id);

  if (!session) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });

  // 응답 집계
  const distribution = db.prepare(`
    SELECT answer, COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM quiz_answers WHERE session_id = ?), 0) as percent
    FROM quiz_answers WHERE session_id = ?
    GROUP BY answer
    ORDER BY answer
  `).all(id, id);

  // 오답 학생 목록
  const wrongStudents = db.prepare(`
    SELECT s.name
    FROM quiz_answers qa
    JOIN enrollments e ON e.id = qa.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE qa.session_id = ? AND qa.is_correct = 0
    ORDER BY s.name
  `).all(id);

  // 학생별 응답 상세 (이름, 답, 정오, 제출시각)
  const studentAnswers = db.prepare(`
    SELECT s.name, qa.answer, qa.is_correct, qa.answered_at
    FROM quiz_answers qa
    JOIN enrollments e ON e.id = qa.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE qa.session_id = ?
    ORDER BY qa.answered_at ASC
  `).all(id);

  // 총 인원 & 응답 인원
  const totalStudents = db.prepare(`
    SELECT COUNT(*) as cnt FROM enrollments WHERE course_id = ?
  `).get(session.course_id).cnt;

  const totalAnswered = db.prepare(`
    SELECT COUNT(*) as cnt FROM quiz_answers WHERE session_id = ?
  `).get(id).cnt;

  res.json({
    success: true,
    data: {
      session: {
        ...session,
        options: session.options ? JSON.parse(session.options) : null,
      },
      distribution,
      wrongStudents,
      studentAnswers,
      totalStudents,
      totalAnswered,
    }
  });
});

// ─────────────────────────────────────────
// GET /api/achievements/:courseId — 성취도 목록
// ─────────────────────────────────────────
router.get('/achievements/:courseId', (req, res) => {
  const { courseId } = req.params;

  const achievements = db.prepare(`
    SELECT
      e.id as enrollment_id,
      s.name,
      -- 퀴즈 정답률
      ROUND(COALESCE((SELECT AVG(is_correct) * 100 FROM quiz_answers WHERE enrollment_id = e.id), 0), 0) as quiz_score,
      -- 이해도 평균
      ROUND(COALESCE((SELECT AVG(
        CASE label
          WHEN '잘됨' THEN 100 WHEN '완료' THEN 100 WHEN '적당해요' THEN 100
          WHEN '애매' THEN 50  WHEN '진행중' THEN 50 WHEN '빨라요' THEN 50
          WHEN '모름' THEN 0   WHEN '막힘' THEN 0    WHEN '느려요' THEN 0
          ELSE NULL
        END
      ) FROM feedback_logs WHERE enrollment_id = e.id), 0), 0) as understanding_avg,
      -- 성취도
      ROUND(
        COALESCE((SELECT AVG(is_correct) * 100 FROM quiz_answers WHERE enrollment_id = e.id), 0) * 0.7 +
        COALESCE((SELECT AVG(
          CASE label
            WHEN '잘됨' THEN 100 WHEN '완료' THEN 100 WHEN '적당해요' THEN 100
            WHEN '애매' THEN 50  WHEN '진행중' THEN 50 WHEN '빨라요' THEN 50
            WHEN '모름' THEN 0   WHEN '막힘' THEN 0    WHEN '느려요' THEN 0
            ELSE NULL
          END
        ) FROM feedback_logs WHERE enrollment_id = e.id), 0) * 0.3
      , 0) as achievement
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.course_id = ?
    ORDER BY achievement DESC
  `).all(courseId);

  // 등수 부여
  achievements.forEach((s, i) => { s.rank = i + 1; });

  res.json({ success: true, data: achievements });
});

module.exports = router;
