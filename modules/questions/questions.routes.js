// 문제 은행 API 라우터

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────
// GET /api/questions — 문제 목록 (과정/과목/챕터 필터)
// ─────────────────────────────────────────
router.get('/questions', (req, res) => {
  const { course_id, subject, chapter } = req.query;

  let sql = 'SELECT * FROM questions WHERE 1=1';
  const params = [];

  if (course_id) { sql += ' AND course_id = ?'; params.push(course_id); }
  if (subject)   { sql += ' AND subject = ?';   params.push(subject); }
  if (chapter)   { sql += ' AND chapter = ?';   params.push(chapter); }

  sql += ' ORDER BY subject, chapter, id';

  const questions = db.prepare(sql).all(...params);
  const parsed = questions.map(q => ({
    ...q,
    options: q.options ? JSON.parse(q.options) : null,
  }));

  res.json({ success: true, data: parsed });
});

// ─────────────────────────────────────────
// GET /api/questions/subjects — 과목 목록
// ─────────────────────────────────────────
router.get('/questions/subjects', (req, res) => {
  const { course_id } = req.query;
  const subjects = db.prepare(`
    SELECT DISTINCT subject FROM questions
    WHERE course_id = ?
    ORDER BY subject
  `).all(course_id);

  res.json({ success: true, data: subjects.map(s => s.subject) });
});

// ─────────────────────────────────────────
// GET /api/questions/chapters — 챕터 목록
// ─────────────────────────────────────────
router.get('/questions/chapters', (req, res) => {
  const { course_id, subject } = req.query;
  const chapters = db.prepare(`
    SELECT DISTINCT chapter FROM questions
    WHERE course_id = ? AND subject = ?
    ORDER BY chapter
  `).all(course_id, subject);

  res.json({ success: true, data: chapters.map(c => c.chapter) });
});

// ─────────────────────────────────────────
// GET /api/questions/random — 랜덤 문제 추출
// ─────────────────────────────────────────
router.get('/questions/random', (req, res) => {
  const { course_id, subject, chapter, count = 5 } = req.query;

  let sql = 'SELECT * FROM questions WHERE course_id = ?';
  const params = [course_id];

  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (chapter) { sql += ' AND chapter = ?'; params.push(chapter); }

  sql += ` ORDER BY RANDOM() LIMIT ?`;
  params.push(parseInt(count));

  const questions = db.prepare(sql).all(...params);
  const parsed = questions.map(q => ({
    ...q,
    options: q.options ? JSON.parse(q.options) : null,
  }));

  res.json({ success: true, data: parsed });
});

// ─────────────────────────────────────────
// POST /api/questions — 문제 추가
// ─────────────────────────────────────────
router.post('/questions', (req, res) => {
  const { course_id, subject, chapter, type, question, options, answer, explanation } = req.body;

  if (!course_id || !subject || !chapter || !type || !question || !answer) {
    return res.status(400).json({ success: false, message: '필수 항목이 누락되었습니다.' });
  }

  const result = db.prepare(`
    INSERT INTO questions (course_id, subject, chapter, type, question, options, answer, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    course_id, subject, chapter, type, question,
    options ? JSON.stringify(options) : null,
    answer, explanation || ''
  );

  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: { ...q, options: q.options ? JSON.parse(q.options) : null } });
});

// ─────────────────────────────────────────
// PUT /api/questions/:id — 문제 수정
// ─────────────────────────────────────────
router.put('/questions/:id', (req, res) => {
  const { subject, chapter, type, question, options, answer, explanation } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM questions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '문제를 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE questions SET
      subject = COALESCE(?, subject),
      chapter = COALESCE(?, chapter),
      type = COALESCE(?, type),
      question = COALESCE(?, question),
      options = COALESCE(?, options),
      answer = COALESCE(?, answer),
      explanation = COALESCE(?, explanation)
    WHERE id = ?
  `).run(subject||null, chapter||null, type||null, question||null,
         options?JSON.stringify(options):null, answer||null, explanation||null, id);

  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  res.json({ success: true, data: { ...q, options: q.options ? JSON.parse(q.options) : null } });
});

// ─────────────────────────────────────────
// DELETE /api/questions/:id — 문제 삭제
// ─────────────────────────────────────────
router.delete('/questions/:id', (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// GET /api/questions/export-template — 엑셀 양식 다운로드
// ─────────────────────────────────────────
router.get('/questions/export-template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['과목', '챕터', '유형(OX/4지)', '문제', '보기A', '보기B', '보기C', '보기D', '정답', '해설'],
    ['디지털회로설계', '챕터1', 'OX', 'NAND 게이트는 AND의 반전이다.', '', '', '', '', 'O', 'NAND = NOT AND'],
    ['디지털회로설계', '챕터1', '4지', 'NAND 게이트 출력이 0이 되려면?', '입력이 모두 0', '입력이 모두 1', '입력 중 하나가 1', '항상 0', 'B', '모든 입력이 1일 때만 출력이 0'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, '문제은행');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=classson_questions_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// ─────────────────────────────────────────
// POST /api/questions/import-excel — 엑셀 업로드
// ─────────────────────────────────────────
router.post('/questions/import-excel', upload.single('file'), (req, res) => {
  const { course_id } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
  if (!course_id) return res.status(400).json({ success: false, message: '과정ID는 필수입니다.' });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const insert = db.prepare(`
      INSERT INTO questions (course_id, subject, chapter, type, question, options, answer, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const subject  = String(row['과목'] || '').trim();
        const chapter  = String(row['챕터'] || '').trim();
        const typeRaw  = String(row['유형(OX/4지)'] || '').trim();
        const question = String(row['문제'] || '').trim();
        const answer   = String(row['정답'] || '').trim();
        const explain  = String(row['해설'] || '').trim();

        if (!subject || !chapter || !question || !answer) continue;

        const type = typeRaw.includes('4') ? '4choice' : 'ox';
        let options = null;
        if (type === '4choice') {
          const opts = [
            String(row['보기A'] || ''), String(row['보기B'] || ''),
            String(row['보기C'] || ''), String(row['보기D'] || ''),
          ];
          options = JSON.stringify(opts);
        }

        insert.run(course_id, subject, chapter, type, question, options, answer, explain);
        count++;
      }
    });

    insertMany(rows);
    res.json({ success: true, message: `${count}개 문제가 등록되었습니다.`, count });
  } catch (e) {
    res.status(500).json({ success: false, message: '파일 처리 오류: ' + e.message });
  }
});

module.exports = router;
