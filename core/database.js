// ClassOn 데이터베이스 모듈
// Node.js 내장 SQLite (node:sqlite) 사용 — 빌드 불필요

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

// DB 파일 경로: 프로젝트 루트/data/classson.db
const DB_PATH = path.join(__dirname, '..', 'data', 'classson.db');

// DB 연결 (없으면 자동 생성)
const db = new DatabaseSync(DB_PATH);

// 성능 최적화: WAL 모드, 외래 키 활성화
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ============================================================
// better-sqlite3 호환 래퍼
// node:sqlite의 get()은 null prototype 객체를 반환하므로
// 일반 객체로 변환하는 헬퍼 추가
// ============================================================

/** null prototype 객체를 일반 객체로 변환 */
function toPlain(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(toPlain);
  return Object.assign({}, obj);
}

// prepare 래퍼: get/all 결과를 일반 객체로 변환
const originalPrepare = db.prepare.bind(db);
db.prepare = function(sql) {
  const stmt = originalPrepare(sql);
  const origGet = stmt.get.bind(stmt);
  const origAll = stmt.all.bind(stmt);
  stmt.get  = (...args) => toPlain(origGet(...args));
  stmt.all  = (...args) => toPlain(origAll(...args));
  return stmt;
};

// transaction 헬퍼 (better-sqlite3 호환)
db.transaction = function(fn) {
  return function(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

// ============================================================
// 스키마 초기화 (테이블이 없을 때만 생성)
// ============================================================
function initSchema() {
  db.exec(`

    -- 시스템 설정 (비밀번호, 기타 설정값)
    CREATE TABLE IF NOT EXISTS system_config (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      key   TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

    -- 과정(코호트): 반도체설계 3기, 임베디드 2기 등
    CREATE TABLE IF NOT EXISTS courses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      cohort      TEXT NOT NULL,
      start_date  TEXT,
      end_date    TEXT,
      status      TEXT DEFAULT 'active',
      is_today    INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 학생 기본 정보
    CREATE TABLE IF NOT EXISTS students (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      gender     TEXT,
      age        INTEGER,
      school     TEXT,
      major      TEXT,
      phone      TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 과정-학생 연결 (수강 등록)
    CREATE TABLE IF NOT EXISTS enrollments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      seat_no    INTEGER,
      memo       TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(course_id, student_id)
    );

    -- 출석 기록
    CREATE TABLE IF NOT EXISTS attendance (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      date          TEXT NOT NULL,
      status        TEXT DEFAULT 'absent',
      connected_at  TEXT,
      UNIQUE(enrollment_id, date)
    );

    -- 피드백 버튼 세트
    CREATE TABLE IF NOT EXISTS button_sets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   INTEGER REFERENCES courses(id),
      name        TEXT NOT NULL,
      style       TEXT DEFAULT 'emoji',
      buttons     TEXT NOT NULL,
      is_default  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 피드백 클릭 이력
    CREATE TABLE IF NOT EXISTS feedback_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      button_set_id INTEGER REFERENCES button_sets(id),
      button_index  INTEGER NOT NULL,
      color         TEXT,
      emoji         TEXT,
      label         TEXT,
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 익명 질문
    CREATE TABLE IF NOT EXISTS questions_anon (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      course_id     INTEGER NOT NULL REFERENCES courses(id),
      text          TEXT NOT NULL,
      is_checked    INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 도움 요청 대기열
    CREATE TABLE IF NOT EXISTS help_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      course_id     INTEGER NOT NULL REFERENCES courses(id),
      status        TEXT DEFAULT 'waiting',
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 퀴즈 문제
    CREATE TABLE IF NOT EXISTS quizzes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   INTEGER REFERENCES courses(id),
      title       TEXT,
      type        TEXT NOT NULL,
      question    TEXT NOT NULL,
      options     TEXT,
      answer      TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      time_limit  INTEGER DEFAULT 30,
      source      TEXT DEFAULT 'instant',
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 퀴즈 진행 세션
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id    INTEGER NOT NULL REFERENCES quizzes(id),
      course_id  INTEGER NOT NULL REFERENCES courses(id),
      status     TEXT DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now','localtime')),
      ended_at   TEXT
    );

    -- 학생별 퀴즈 응답
    CREATE TABLE IF NOT EXISTS quiz_answers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER NOT NULL REFERENCES quiz_sessions(id),
      enrollment_id   INTEGER NOT NULL REFERENCES enrollments(id),
      answer          TEXT NOT NULL,
      is_correct      INTEGER,
      answered_at     TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(session_id, enrollment_id)
    );

    -- 문제 은행
    CREATE TABLE IF NOT EXISTS questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   INTEGER NOT NULL REFERENCES courses(id),
      subject     TEXT NOT NULL,
      chapter     TEXT NOT NULL,
      type        TEXT NOT NULL,
      question    TEXT NOT NULL,
      options     TEXT,
      answer      TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 팀 편성 결과
    CREATE TABLE IF NOT EXISTS teams (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id),
      name       TEXT NOT NULL,
      members    TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 교실 레이아웃
    CREATE TABLE IF NOT EXISTS layouts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      course_id  INTEGER REFERENCES courses(id),
      desks      TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 피드백 전체 초기화 이력 (초기화 이후 피드백만 유효)
    CREATE TABLE IF NOT EXISTS feedback_clears (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER REFERENCES courses(id),
      cleared_at TEXT DEFAULT (datetime('now','localtime'))
    );

  `);
}

// ============================================================
// 초기 데이터 삽입 (최초 실행 시)
// ============================================================
function initData() {
  // 관리자 비밀번호 (기본: admin1234)
  const pwRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('password');
  if (!pwRow) {
    const hash = bcrypt.hashSync('admin1234', 10);
    db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('password', hash);
    console.log('[DB] 기본 비밀번호 설정: admin1234');
  }

  // 기본 피드백 버튼 세트 3개 삽입
  const setCount = db.prepare('SELECT COUNT(*) as cnt FROM button_sets WHERE is_default = 1').get();
  if (setCount.cnt === 0) {
    const insertSet = db.prepare(`
      INSERT INTO button_sets (course_id, name, style, buttons, is_default)
      VALUES (?, ?, ?, ?, 1)
    `);

    // 기본 세트 1: 이해도 확인
    insertSet.run(null, '이해도 확인', 'emoji', JSON.stringify([
      { emoji: '😊', label: '잘됨',  color: '#10B981' },
      { emoji: '🤔', label: '애매',  color: '#F59E0B' },
      { emoji: '😵', label: '모름',  color: '#EF4444' },
      { emoji: '✋', label: '질문',  color: '#2563EB' },
    ]));

    // 기본 세트 2: 실습 진행도
    insertSet.run(null, '실습 진행도', 'emoji', JSON.stringify([
      { emoji: '✅', label: '완료',   color: '#10B981' },
      { emoji: '🔄', label: '진행중', color: '#F59E0B' },
      { emoji: '🆘', label: '막힘',   color: '#EF4444' },
    ]));

    // 기본 세트 3: 속도 조절
    insertSet.run(null, '속도 조절', 'emoji', JSON.stringify([
      { emoji: '🐇', label: '빨라요',  color: '#2563EB' },
      { emoji: '👍', label: '적당해요', color: '#10B981' },
      { emoji: '🐢', label: '느려요',  color: '#F59E0B' },
    ]));

    console.log('[DB] 기본 피드백 버튼 세트 3개 생성 완료');
  }
}

// ============================================================
// 초기화 실행
// ============================================================
initSchema();
initData();

console.log(`[DB] SQLite 연결 완료: ${DB_PATH}`);

module.exports = db;
