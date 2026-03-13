// 교실 레이아웃 API 라우터

const express = require('express');
const router = express.Router();
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

router.use(requireAuth);

// ─────────────────────────────────────────
// GET /api/layouts — 레이아웃 목록
// ─────────────────────────────────────────
router.get('/layouts', (req, res) => {
  const { course_id } = req.query;

  let sql = 'SELECT id, name, course_id, created_at FROM layouts';
  const params = [];

  if (course_id) {
    sql += ' WHERE course_id = ? OR course_id IS NULL';
    params.push(course_id);
  }

  sql += ' ORDER BY created_at DESC';

  const layouts = db.prepare(sql).all(...params);
  res.json({ success: true, data: layouts });
});

// ─────────────────────────────────────────
// GET /api/layouts/:id — 레이아웃 단건 (책상 데이터 포함)
// ─────────────────────────────────────────
router.get('/layouts/:id', (req, res) => {
  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(req.params.id);
  if (!layout) return res.status(404).json({ success: false, message: '레이아웃을 찾을 수 없습니다.' });

  res.json({
    success: true,
    data: {
      ...layout,
      desks: JSON.parse(layout.desks),
    }
  });
});

// ─────────────────────────────────────────
// POST /api/layouts — 레이아웃 저장
// ─────────────────────────────────────────
router.post('/layouts', (req, res) => {
  const { name, course_id, desks } = req.body;

  if (!name || !desks) {
    return res.status(400).json({ success: false, message: '레이아웃명과 책상 데이터는 필수입니다.' });
  }

  const result = db.prepare(`
    INSERT INTO layouts (name, course_id, desks) VALUES (?, ?, ?)
  `).run(name, course_id || null, JSON.stringify(desks));

  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: { ...layout, desks: JSON.parse(layout.desks) } });
});

// ─────────────────────────────────────────
// PUT /api/layouts/:id — 레이아웃 수정 (책상 위치 저장)
// ─────────────────────────────────────────
router.put('/layouts/:id', (req, res) => {
  const { name, desks } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM layouts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '레이아웃을 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE layouts SET
      name = COALESCE(?, name),
      desks = COALESCE(?, desks)
    WHERE id = ?
  `).run(name || null, desks ? JSON.stringify(desks) : null, id);

  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id);
  res.json({ success: true, data: { ...layout, desks: JSON.parse(layout.desks) } });
});

// ─────────────────────────────────────────
// DELETE /api/layouts/:id — 레이아웃 삭제
// ─────────────────────────────────────────
router.delete('/layouts/:id', (req, res) => {
  db.prepare('DELETE FROM layouts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
