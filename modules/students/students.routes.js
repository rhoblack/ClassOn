// 학생 관리 API 라우터

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const db = require('../../core/database');
const { requireAuth } = require('../../core/auth');

// 모든 API는 강사 인증 필요
router.use(requireAuth);

// 파일 업로드 설정 (메모리에 저장)
const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────
// GET /api/students — 학생 목록 (과정별)
// ─────────────────────────────────────────
router.get('/students', (req, res) => {
  const { course_id, sort } = req.query;

  if (!course_id) {
    // 전체 학생 목록
    const students = db.prepare('SELECT * FROM students ORDER BY name').all();
    return res.json({ success: true, data: students });
  }

  // 과정별 수강생 목록 + 성취도
  let orderBy = 'achievement DESC';
  if (sort === 'name') orderBy = 's.name ASC';
  if (sort === 'understanding') orderBy = 'understanding_avg DESC';

  const students = db.prepare(`
    SELECT
      s.*,
      e.id as enrollment_id,
      e.seat_no,
      e.memo,
      -- 출석률 계산
      ROUND(
        (SELECT COUNT(*) FROM attendance WHERE enrollment_id = e.id AND status = 'present') * 100.0 /
        MAX((SELECT COUNT(*) FROM attendance WHERE enrollment_id = e.id), 1)
      , 0) as attendance_rate,
      -- 퀴즈 정답률
      ROUND(
        (SELECT AVG(is_correct) * 100 FROM quiz_answers WHERE enrollment_id = e.id)
      , 0) as quiz_score,
      -- 이해도 평균 (잘됨=100, 애매=50, 모름=0, 질문=제외)
      ROUND(
        (SELECT AVG(
          CASE label
            WHEN '잘됨' THEN 100
            WHEN '완료' THEN 100
            WHEN '적당해요' THEN 100
            WHEN '애매' THEN 50
            WHEN '진행중' THEN 50
            WHEN '빨라요' THEN 50
            WHEN '모름' THEN 0
            WHEN '막힘' THEN 0
            WHEN '느려요' THEN 0
            ELSE NULL
          END
        ) FROM feedback_logs WHERE enrollment_id = e.id)
      , 0) as understanding_avg,
      -- 성취도 = 퀴즈 70% + 이해도 30%
      ROUND(
        COALESCE(
          (SELECT AVG(is_correct) * 100 FROM quiz_answers WHERE enrollment_id = e.id), 0
        ) * 0.7 +
        COALESCE(
          (SELECT AVG(
            CASE label
              WHEN '잘됨' THEN 100 WHEN '완료' THEN 100 WHEN '적당해요' THEN 100
              WHEN '애매' THEN 50  WHEN '진행중' THEN 50 WHEN '빨라요' THEN 50
              WHEN '모름' THEN 0   WHEN '막힘' THEN 0    WHEN '느려요' THEN 0
              ELSE NULL
            END
          ) FROM feedback_logs WHERE enrollment_id = e.id), 0
        ) * 0.3
      , 0) as achievement,
      -- 최근 피드백 (최근 5개)
      (SELECT GROUP_CONCAT(emoji, '') FROM (
        SELECT emoji FROM feedback_logs WHERE enrollment_id = e.id
        ORDER BY created_at DESC LIMIT 5
      )) as recent_feedback
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.course_id = ?
    ORDER BY ${orderBy}
  `).all(course_id);

  // 등수 계산 (성취도 기준)
  const sorted = [...students].sort((a, b) => b.achievement - a.achievement);
  const rankMap = new Map();
  sorted.forEach((s, i) => rankMap.set(s.enrollment_id, i + 1));
  students.forEach(s => { s.rank = rankMap.get(s.enrollment_id); });

  res.json({ success: true, data: students });
});

// ─────────────────────────────────────────
// GET /api/students/export — CSV / 엑셀 다운로드
// ─────────────────────────────────────────
router.get('/students/export', (req, res) => {
  const { course_id, format } = req.query;
  if (!course_id) return res.status(400).json({ success: false, message: 'course_id 필요' });

  const students = db.prepare(`
    SELECT
      s.name, s.gender, s.age, s.school, s.major, s.phone,
      e.memo,
      ROUND(
        (SELECT COUNT(*) FROM attendance WHERE enrollment_id = e.id AND status = 'present') * 100.0 /
        MAX((SELECT COUNT(*) FROM attendance WHERE enrollment_id = e.id), 1)
      , 0) as attendance_rate,
      ROUND(
        (SELECT AVG(is_correct) * 100 FROM quiz_answers WHERE enrollment_id = e.id)
      , 0) as quiz_score,
      ROUND(
        (SELECT AVG(
          CASE label
            WHEN '잘됨' THEN 100 WHEN '완료' THEN 100 WHEN '적당해요' THEN 100
            WHEN '애매' THEN 50  WHEN '진행중' THEN 50 WHEN '빨라요' THEN 50
            WHEN '모름' THEN 0   WHEN '막힘' THEN 0    WHEN '느려요' THEN 0
            ELSE NULL
          END
        ) FROM feedback_logs WHERE enrollment_id = e.id)
      , 0) as understanding_avg,
      ROUND(
        COALESCE((SELECT AVG(is_correct)*100 FROM quiz_answers WHERE enrollment_id=e.id),0)*0.7 +
        COALESCE((SELECT AVG(CASE label
          WHEN '잘됨' THEN 100 WHEN '완료' THEN 100 WHEN '적당해요' THEN 100
          WHEN '애매' THEN 50  WHEN '진행중' THEN 50 WHEN '빨라요' THEN 50
          WHEN '모름' THEN 0   WHEN '막힘' THEN 0    WHEN '느려요' THEN 0
          ELSE NULL END) FROM feedback_logs WHERE enrollment_id=e.id),0)*0.3
      , 0) as achievement
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.course_id = ?
    ORDER BY s.name ASC
  `).all(course_id);

  const rows = students.map(s => ({
    '이름':        s.name || '',
    '성별':        s.gender || '',
    '나이':        s.age ?? '',
    '학교':        s.school || '',
    '전공':        s.major || '',
    '전화번호':    s.phone || '',
    '출석률(%)':   s.attendance_rate ?? 0,
    '퀴즈점수(%)': s.quiz_score ?? 0,
    '이해도(%)':   s.understanding_avg ?? 0,
    '성취도(%)':   s.achievement ?? 0,
    '메모':        s.memo || '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '학생목록');

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students.xlsx"');
    res.send(buf);
  }
});

// ─────────────────────────────────────────
// GET /api/students/:id — 학생 단건 + 상세 정보
// ─────────────────────────────────────────
router.get('/students/:id', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ success: false, message: '학생을 찾을 수 없습니다.' });
  res.json({ success: true, data: student });
});

// ─────────────────────────────────────────
// POST /api/students — 학생 추가
// ─────────────────────────────────────────
router.post('/students', (req, res) => {
  const { name, gender, age, school, major, phone, course_id } = req.body;

  if (!name) return res.status(400).json({ success: false, message: '이름은 필수입니다.' });

  // 학생 생성
  const result = db.prepare(`
    INSERT INTO students (name, gender, age, school, major, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, gender || null, age || null, school || null, major || null, phone || null);

  const studentId = result.lastInsertRowid;

  // 과정에 수강 등록
  if (course_id) {
    try {
      db.prepare(`
        INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)
      `).run(course_id, studentId);
    } catch (e) {
      // 이미 등록된 경우 무시
    }
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  res.json({ success: true, data: student });
});

// ─────────────────────────────────────────
// PUT /api/students/:id — 학생 정보 수정
// ─────────────────────────────────────────
router.put('/students/:id', (req, res) => {
  const { name, gender, age, school, major, phone } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: '학생을 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE students SET
      name = COALESCE(?, name),
      gender = COALESCE(?, gender),
      age = COALESCE(?, age),
      school = COALESCE(?, school),
      major = COALESCE(?, major),
      phone = COALESCE(?, phone)
    WHERE id = ?
  `).run(name || null, gender || null, age || null, school || null, major || null, phone || null, id);

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  res.json({ success: true, data: student });
});

// ─────────────────────────────────────────
// DELETE /api/students/:id — 학생 삭제
// ─────────────────────────────────────────
router.delete('/students/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: '학생을 찾을 수 없습니다.' });

  try {
    // 외래키 참조 데이터 연쇄 삭제
    const deleteStudent = db.transaction(() => {
      // enrollments 조회 후 연쇄 삭제
      const enrollments = db.prepare('SELECT id FROM enrollments WHERE student_id = ?').all(req.params.id);
      for (const e of enrollments) {
        db.prepare('DELETE FROM attendance WHERE enrollment_id = ?').run(e.id);
        db.prepare('DELETE FROM feedback_logs WHERE enrollment_id = ?').run(e.id);
        db.prepare('DELETE FROM quiz_answers WHERE enrollment_id = ?').run(e.id);
        db.prepare('DELETE FROM questions_anon WHERE enrollment_id = ?').run(e.id);
        db.prepare('DELETE FROM help_requests WHERE enrollment_id = ?').run(e.id);
      }
      db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(req.params.id);
      db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
    });
    deleteStudent();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: '학생 삭제 실패: ' + e.message });
  }
});


// ─────────────────────────────────────────
// POST /api/enrollments — 수강 등록
// ─────────────────────────────────────────
router.post('/enrollments', (req, res) => {
  const { course_id, student_id } = req.body;

  if (!course_id || !student_id) {
    return res.status(400).json({ success: false, message: '과정ID와 학생ID는 필수입니다.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)
    `).run(course_id, student_id);

    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (e) {
    res.status(400).json({ success: false, message: '이미 등록된 학생입니다.' });
  }
});

// ─────────────────────────────────────────
// DELETE /api/enrollments/:id — 수강 등록 취소
// ─────────────────────────────────────────
router.delete('/enrollments/:id', (req, res) => {
  db.prepare('DELETE FROM enrollments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// PUT /api/enrollments/:id/memo — 강사 메모 저장
// ─────────────────────────────────────────
router.put('/enrollments/:id/memo', (req, res) => {
  const { memo } = req.body;
  db.prepare('UPDATE enrollments SET memo = ? WHERE id = ?').run(memo || '', req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// POST /api/students/import-csv — CSV/엑셀 업로드
// ─────────────────────────────────────────
router.post('/students/import-csv', upload.single('file'), (req, res) => {
  const { course_id, mapping } = req.body;

  if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

  try {
    const buf = req.file.buffer;
    const ext = (req.file.originalname || '').split('.').pop().toLowerCase();

    let workbook;
    if (ext === 'csv') {
      // UTF-8 BOM(EF BB BF)이면 UTF-8, 아니면 EUC-KR/UTF-8 자동 감지
      let text;
      if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        text = iconv.decode(buf, 'utf-8'); // UTF-8 with BOM
      } else {
        const utf8Text  = iconv.decode(buf, 'utf-8');
        const euckrText = iconv.decode(buf, 'euc-kr');
        // UTF-8 디코딩에 대체문자(\uFFFD)가 있으면 EUC-KR이 원본
        text = (utf8Text.includes('\uFFFD') && /[가-힣]/.test(euckrText))
          ? euckrText : utf8Text;
      }
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      // OLE2 매직바이트(D0 CF) = 구식 xls 포맷 → CP949 코드페이지 지정
      const isLegacyXls = buf[0] === 0xD0 && buf[1] === 0xCF;
      workbook = XLSX.read(buf, { type: 'buffer', codepage: isLegacyXls ? 949 : 0 });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });


    if (rawRows.length === 0) {
      return res.json({ success: true, message: '파일에 데이터가 없습니다.', count: 0 });
    }

    // BOM 및 공백 제거 후 컬럼 정규화
    const normalize = s => String(s).replace(/^\uFEFF/, '').trim().toLowerCase();
    const rawKeys = Object.keys(rawRows[0]);
    const keyMap = {};
    rawKeys.forEach(k => { keyMap[normalize(k)] = k; });

    // 컬럼 후보 목록 (우선순위 순)
    const candidates = {
      name:   ['이름', '성명', '학생명', '학생이름', 'name', '이 름'],
      gender: ['성별', 'gender', '성 별'],
      age:    ['나이', '연령', 'age', '나 이'],
      school: ['학교', '학교명', 'school', '학 교'],
      major:  ['전공', '학과', 'major', '전 공'],
      phone:  ['전화번호', '전화', '연락처', 'phone', '휴대폰', '전화 번호'],
    };

    const col = {};
    for (const [field, aliases] of Object.entries(candidates)) {
      for (const alias of aliases) {
        const raw = keyMap[normalize(alias)];
        if (raw !== undefined) { col[field] = raw; break; }
      }
    }

    // 이름 컬럼 못 찾으면 첫 번째 컬럼으로 대체
    if (!col.name) col.name = rawKeys[0];

    // BOM 제거된 행 데이터
    const rows = rawRows.map(row => {
      const clean = {};
      for (const k of rawKeys) clean[k] = row[k];
      return clean;
    });

    const insertStudent = db.prepare(`
      INSERT INTO students (name, gender, age, school, major, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertEnrollment = db.prepare(`
      INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)
    `);

    let count = 0;
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const name = String(row[col.name] || '').trim();
        if (!name) continue;

        const result = insertStudent.run(
          name,
          col.gender  ? String(row[col.gender]  || '').trim() || null : null,
          col.age     ? parseInt(row[col.age])  || null                : null,
          col.school  ? String(row[col.school]  || '').trim() || null : null,
          col.major   ? String(row[col.major]   || '').trim() || null : null,
          col.phone   ? String(row[col.phone]   || '').trim() || null : null,
        );

        if (course_id) {
          insertEnrollment.run(course_id, result.lastInsertRowid);
        }
        count++;
      }
    });

    insertMany(rows);

    res.json({ success: true, message: `${count}명의 학생이 등록되었습니다.`, count });
  } catch (e) {
    res.status(500).json({ success: false, message: '파일 처리 오류: ' + e.message });
  }
});

module.exports = router;
