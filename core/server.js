// ClassOn 메인 서버
// Express + Socket.io 서버 시작점

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');

// 설정 및 모듈 로드
const modulesConfig = require('../config/modules.config');
const { requireAuth, login } = require('./auth');
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },  // 로컬 네트워크 허용
});

const PORT = process.env.PORT || 3000;

// ============================================================
// 미들웨어 설정
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 세션 설정 (강사 로그인용)
app.use(session({
  secret: 'classson-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,  // 24시간
    httpOnly: true,
  },
}));

// teacher 경로는 인증 후에만 정적 파일 접근 허용
app.use('/teacher', requireAuth);

// 학생 화면 라우트 (static보다 먼저 등록해야 /student 경로가 301이 되지 않음)
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'student', 'index.html'));
});

app.get('/student/class', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'student', 'class.html'));
});

// 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// 인증 라우트 (로그인/로그아웃)
// ============================================================

// 루트: 강사로 로그인된 경우 대시보드, 아니면 역할 선택 랜딩 페이지
app.get('/', (req, res) => {
  if (req.session && req.session.isTeacher) {
    return res.redirect('/teacher/dashboard.html');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 로그인 페이지
app.get('/login', (req, res) => {
  if (req.session && req.session.isTeacher) {
    return res.redirect('/teacher/dashboard.html');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// 로그인 API
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const result = login(password);

  if (result.success) {
    req.session.isTeacher = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: result.message });
  }
});

// 로그아웃 API
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ============================================================
// 학생용 공개 API (인증 불필요 — 모듈 라우터보다 먼저 등록)
// ============================================================
const db = require('./database');

app.get('/api/courses-today', (req, res) => {
  const course = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
    FROM courses c WHERE c.is_today = 1
  `).get();
  res.json({ success: true, data: course || null });
});

app.get('/api/enrollments/:courseId', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, s.name, s.gender, s.age, s.school, s.major, s.phone
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.course_id = ?
    ORDER BY s.name
  `).all(req.params.courseId);
  res.json({ success: true, data: rows });
});

app.get('/api/button-sets', (req, res) => {
  const { course_id } = req.query;
  const sets = db.prepare(`
    SELECT * FROM button_sets
    WHERE course_id IS NULL OR course_id = ?
    ORDER BY is_default DESC, created_at ASC
  `).all(course_id || 0);
  const parsed = sets.map(s => ({ ...s, buttons: JSON.parse(s.buttons) }));
  res.json({ success: true, data: parsed });
});

// ============================================================
// 모듈별 라우터 등록
// ============================================================
const modules = [
  { name: 'courses',   path: '../modules/courses/courses.routes'   },
  { name: 'students',  path: '../modules/students/students.routes'  },
  { name: 'feedback',  path: '../modules/feedback/feedback.routes'  },
  { name: 'quiz',      path: '../modules/quiz/quiz.routes'          },
  { name: 'questions', path: '../modules/questions/questions.routes' },
  { name: 'teams',     path: '../modules/teams/teams.routes'        },
  { name: 'layout',    path: '../modules/layout/layout.routes'      },
  { name: 'system',    path: '../modules/system/system.routes'      },
];

modules.forEach(({ name, path: modulePath }) => {
  if (modulesConfig[name]) {
    try {
      const router = require(modulePath);
      app.use('/api', router);
      console.log(`[Module] ${name} 로드 완료`);
    } catch (e) {
      console.error(`[Module] ${name} 로드 실패:`, e.message);
    }
  } else {
    console.log(`[Module] ${name} 비활성화 (config에서 false)`);
  }
});

// ============================================================
// Socket.io 초기화
// ============================================================
initSocket(io);

// io 인스턴스를 라우터에서 사용할 수 있도록 앱에 저장
app.set('io', io);

// ============================================================
// 서버 시작
// ============================================================
server.listen(PORT, '0.0.0.0', () => {
  // 로컬 IP 조회
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  // WSL/Docker 가상 어댑터(172.16~31, 192.168.x.x Docker) 제외, 실제 LAN IP 우선
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  // 10.x.x.x 대역 우선, 없으면 192.168.x.x, 없으면 첫 번째
  const preferred =
    candidates.find(ip => ip.startsWith('10.')) ||
    candidates.find(ip => ip.startsWith('192.168.')) ||
    candidates[0];
  if (preferred) localIP = preferred;

  console.log('\n========================================');
  console.log('   ClassOn 서버 실행 중');
  console.log(`   접속 주소: http://${localIP}:${PORT}`);
  console.log('========================================\n');
});

module.exports = { app, server, io };
