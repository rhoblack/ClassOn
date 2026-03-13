// 팀 편성 API 라우터

const express = require('express');
const router = express.Router();
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

router.use(requireAuth);

// ─────────────────────────────────────────
// GET /api/teams/:courseId — 팀 편성 조회
// ─────────────────────────────────────────
router.get('/teams/:courseId', (req, res) => {
  const teams = db.prepare(`
    SELECT * FROM teams WHERE course_id = ?
    ORDER BY name
  `).all(req.params.courseId);

  const parsed = teams.map(t => ({
    ...t,
    members: JSON.parse(t.members),
  }));

  // 멤버 상세 정보 추가
  const enriched = parsed.map(team => {
    const memberDetails = team.members.map(enrollmentId => {
      const info = db.prepare(`
        SELECT e.id as enrollment_id, s.name,
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
        WHERE e.id = ?
      `).get(enrollmentId);
      return info;
    }).filter(Boolean);

    return { ...team, memberDetails };
  });

  res.json({ success: true, data: enriched });
});

// ─────────────────────────────────────────
// POST /api/teams/auto — 팀 자동 편성
// 성취도 기반 균형 편성 (snake draft 방식)
// ─────────────────────────────────────────
router.post('/teams/auto', (req, res) => {
  const { course_id, team_count } = req.body;

  if (!course_id || !team_count || team_count < 2) {
    return res.status(400).json({ success: false, message: '과정ID와 팀 수(2 이상)는 필수입니다.' });
  }

  // 성취도 기준 정렬된 학생 목록
  const students = db.prepare(`
    SELECT e.id as enrollment_id,
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
    WHERE e.course_id = ?
    ORDER BY achievement DESC
  `).all(course_id);

  // Snake draft 방식으로 팀 편성 (균형있는 배분)
  // 1,2,3,4 / 4,3,2,1 / 1,2,3,4 ...
  const teams = Array.from({ length: team_count }, (_, i) => ({
    name: String.fromCharCode(65 + i) + '팀', // A팀, B팀, ...
    members: [],
  }));

  students.forEach((student, idx) => {
    const round = Math.floor(idx / team_count);
    const pos = idx % team_count;
    const teamIdx = round % 2 === 0 ? pos : (team_count - 1 - pos);
    teams[teamIdx].members.push(student.enrollment_id);
  });

  // 기존 팀 삭제 후 새로 저장
  const saveTeams = db.transaction(() => {
    db.prepare('DELETE FROM teams WHERE course_id = ?').run(course_id);

    const insert = db.prepare(`
      INSERT INTO teams (course_id, name, members) VALUES (?, ?, ?)
    `);

    teams.forEach(team => {
      insert.run(course_id, team.name, JSON.stringify(team.members));
    });
  });

  saveTeams();

  res.json({ success: true, message: `${team_count}개 팀이 편성되었습니다.` });
});

// ─────────────────────────────────────────
// POST /api/teams/manual — 팀 수동 편성 저장
// body: { course_id, teams: [{name, members:[enrollmentId,...]}] }
// ─────────────────────────────────────────
router.post('/teams/manual', (req, res) => {
  const { course_id, teams } = req.body;

  if (!course_id || !Array.isArray(teams)) {
    return res.status(400).json({ success: false, message: 'course_id와 teams 배열은 필수입니다.' });
  }

  const saveTeams = db.transaction(() => {
    db.prepare('DELETE FROM teams WHERE course_id = ?').run(course_id);

    const insert = db.prepare(`
      INSERT INTO teams (course_id, name, members) VALUES (?, ?, ?)
    `);

    teams.forEach(team => {
      insert.run(course_id, team.name || '팀', JSON.stringify(team.members || []));
    });
  });

  saveTeams();

  res.json({ success: true, message: '팀 편성이 저장되었습니다.' });
});

// ─────────────────────────────────────────
// PUT /api/teams/:id — 팀 수동 수정
// ─────────────────────────────────────────
router.put('/teams/:id', (req, res) => {
  const { name, members } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM teams WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '팀을 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE teams SET
      name = COALESCE(?, name),
      members = COALESCE(?, members)
    WHERE id = ?
  `).run(name || null, members ? JSON.stringify(members) : null, id);

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  res.json({ success: true, data: { ...team, members: JSON.parse(team.members) } });
});

// ─────────────────────────────────────────
// DELETE /api/teams/:courseId/all — 팀 전체 초기화
// ─────────────────────────────────────────
router.delete('/teams/:courseId/all', (req, res) => {
  db.prepare('DELETE FROM teams WHERE course_id = ?').run(req.params.courseId);
  res.json({ success: true });
});

module.exports = router;
