// ClassOn Socket.io 실시간 통신 설정
// 학생-강사 간 실시간 이벤트 처리

const db = require('./database');

/**
 * Socket.io 서버 초기화 및 이벤트 등록
 * @param {import('socket.io').Server} io
 */
function initSocket(io) {

  // 현재 접속 중인 학생 정보 (메모리 캐시)
  // key: socketId, value: { enrollmentId, courseId, name }
  const connectedStudents = new Map();

  // 강사 소켓 ID (단일 강사)
  let teacherSocketId = null;

  // 과정별 현재 활성 버튼세트 (key: courseId, value: buttonSet 객체)
  const activeButtonSets = new Map();

  // 과정별 마지막 공지 (key: courseId, value: { text, links })
  const activeNotices = new Map();

  io.on('connection', (socket) => {
    console.log(`[Socket] 연결: ${socket.id}`);

    // ─────────────────────────────────────────
    // 강사 연결 등록
    // ─────────────────────────────────────────
    socket.on('teacher:register', () => {
      teacherSocketId = socket.id;
      socket.join('teacher');

      // 현재 접속 중인 학생 목록을 강사에게 즉시 전송 (페이지 리로드 시 상태 복원)
      const students = Array.from(connectedStudents.values()).map(s => ({
        enrollmentId: s.enrollmentId,
        courseId: s.courseId,
        name: s.name,
      }));
      socket.emit('teacher:sync', { students, activeButtonSets: Object.fromEntries(activeButtonSets) });

      console.log(`[Socket] 강사 등록: ${socket.id} (접속 학생 ${students.length}명 동기화)`);
    });

    // ─────────────────────────────────────────
    // 학생 입장
    // ─────────────────────────────────────────
    socket.on('student:join', (data) => {
      const { enrollmentId, courseId } = data;

      // 수강 등록 정보 조회
      const enrollment = db.prepare(`
        SELECT e.id, s.name, e.course_id
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        WHERE e.id = ? AND e.course_id = ?
      `).get(enrollmentId, courseId);

      if (!enrollment) {
        socket.emit('error', { message: '수강 정보를 찾을 수 없습니다.' });
        return;
      }

      // 소켓 정보 저장
      connectedStudents.set(socket.id, {
        enrollmentId: enrollment.id,
        courseId: enrollment.course_id,
        name: enrollment.name,
      });

      // 과정 룸 입장
      socket.join(`course:${courseId}`);

      // 출석 처리 (오늘 날짜 기준)
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(`
        INSERT OR REPLACE INTO attendance (enrollment_id, date, status, connected_at)
        VALUES (?, ?, 'present', datetime('now','localtime'))
      `).run(enrollmentId, today);

      // 강사에게 학생 접속 알림
      io.to('teacher').emit('teacher:student-joined', {
        enrollmentId: enrollment.id,
        name: enrollment.name,
        courseId: enrollment.course_id,
      });

      // 현재 활성 버튼세트가 있으면 신규 학생에게 즉시 전달
      const currentButtonSet = activeButtonSets.get(String(courseId));
      if (currentButtonSet) {
        socket.emit('student:button-set-change', { buttonSet: currentButtonSet });
      }

      // 마지막 공지가 있으면 신규 학생에게 즉시 전달
      const lastNotice = activeNotices.get(String(courseId));
      if (lastNotice) {
        socket.emit('student:notice', lastNotice);
      }

      console.log(`[Socket] 학생 입장: ${enrollment.name} (과정 ${courseId})`);
    });

    // ─────────────────────────────────────────
    // 학생 피드백 버튼 클릭
    // ─────────────────────────────────────────
    socket.on('student:feedback', (data, callback) => {
      const student = connectedStudents.get(socket.id);
      if (!student) {
        if (typeof callback === 'function') callback({ success: false });
        return;
      }

      const { buttonSetId, buttonIndex, color, emoji, label } = data;

      // DB 저장
      db.prepare(`
        INSERT INTO feedback_logs (enrollment_id, button_set_id, button_index, color, emoji, label)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(student.enrollmentId, buttonSetId || null, buttonIndex, color, emoji, label);

      // 강사에게 실시간 전달
      io.to('teacher').emit('teacher:feedback-update', {
        enrollmentId: student.enrollmentId,
        color,
        emoji,
        label,
        timestamp: new Date().toISOString(),
      });

      // 학생에게 처리 완료 확인 응답
      if (typeof callback === 'function') callback({ success: true });
    });

    // ─────────────────────────────────────────
    // 학생 익명 질문
    // ─────────────────────────────────────────
    socket.on('student:question', (data) => {
      const student = connectedStudents.get(socket.id);
      if (!student) return;

      const { text } = data;
      if (!text || !text.trim()) return;

      // DB 저장
      const result = db.prepare(`
        INSERT INTO questions_anon (enrollment_id, course_id, text)
        VALUES (?, ?, ?)
      `).run(student.enrollmentId, student.courseId, text.trim());

      // 강사에게 학생 이름과 함께 전달
      io.to('teacher').emit('teacher:question-received', {
        id: result.lastInsertRowid,
        text: text.trim(),
        studentName: student.name,
        timestamp: new Date().toISOString(),
      });
    });

    // ─────────────────────────────────────────
    // 학생 도움 요청
    // ─────────────────────────────────────────
    socket.on('student:help-request', () => {
      const student = connectedStudents.get(socket.id);
      if (!student) return;

      // 기존 대기 중인 요청이 있으면 무시
      const existing = db.prepare(`
        SELECT id FROM help_requests
        WHERE enrollment_id = ? AND status = 'waiting'
      `).get(student.enrollmentId);

      if (existing) return;

      // DB 저장
      const result = db.prepare(`
        INSERT INTO help_requests (enrollment_id, course_id)
        VALUES (?, ?)
      `).run(student.enrollmentId, student.courseId);

      // 강사에게 전달
      io.to('teacher').emit('teacher:help-requested', {
        id: result.lastInsertRowid,
        enrollmentId: student.enrollmentId,
        name: student.name,
        timestamp: new Date().toISOString(),
      });
    });

    // ─────────────────────────────────────────
    // 학생 퀴즈 응답
    // ─────────────────────────────────────────
    socket.on('student:quiz-answer', (data) => {
      const student = connectedStudents.get(socket.id);
      if (!student) return;

      const { sessionId, answer } = data;

      // 세션 + 퀴즈 정답 조회
      const session = db.prepare(`
        SELECT qs.id, q.answer as correct_answer, qs.course_id
        FROM quiz_sessions qs
        JOIN quizzes q ON q.id = qs.quiz_id
        WHERE qs.id = ? AND qs.status = 'active'
      `).get(sessionId);

      if (!session) return;

      const isCorrect = answer === session.correct_answer ? 1 : 0;

      // 응답 저장 (중복 시 무시)
      try {
        db.prepare(`
          INSERT OR IGNORE INTO quiz_answers (session_id, enrollment_id, answer, is_correct)
          VALUES (?, ?, ?, ?)
        `).run(sessionId, student.enrollmentId, answer, isCorrect);
      } catch (e) {
        return; // 이미 응답함
      }

      // 현재 집계 계산
      const stats = db.prepare(`
        SELECT answer, COUNT(*) as count
        FROM quiz_answers
        WHERE session_id = ?
        GROUP BY answer
      `).all(sessionId);

      const totalAnswered = db.prepare(`
        SELECT COUNT(*) as cnt FROM quiz_answers WHERE session_id = ?
      `).get(sessionId).cnt;

      const totalStudents = db.prepare(`
        SELECT COUNT(*) as cnt FROM enrollments WHERE course_id = ?
      `).get(session.course_id).cnt;

      // 강사에게 집계 전달
      io.to('teacher').emit('teacher:quiz-answer-update', {
        sessionId,
        answered: totalAnswered,
        total: totalStudents,
        distribution: stats,
      });
    });

    // ─────────────────────────────────────────
    // 강사: 공지 전송
    // ─────────────────────────────────────────
    socket.on('teacher:send-notice', (data) => {
      const { courseId, text, links } = data;
      // 마지막 공지 저장
      activeNotices.set(String(courseId), { text, links: links || [] });
      // 해당 과정 학생 전체에게 공지
      io.to(`course:${courseId}`).emit('student:notice', { text, links: links || [] });
    });

    // ─────────────────────────────────────────
    // 강사: 퀴즈 시작 전달
    // ─────────────────────────────────────────
    socket.on('teacher:quiz-start', (data) => {
      const { courseId, sessionId, quiz } = data;
      io.to(`course:${courseId}`).emit('student:quiz-start', { sessionId, quiz });
    });

    // ─────────────────────────────────────────
    // 강사: 퀴즈 세트 시작 (다중문제 배치)
    // ─────────────────────────────────────────
    socket.on('teacher:quiz-set-start', (data) => {
      const { courseId, quizSet } = data;
      io.to(`course:${courseId}`).emit('student:quiz-set-start', { quizSet });
    });

    // ─────────────────────────────────────────
    // 강사: 퀴즈 세트 종료
    // ─────────────────────────────────────────
    socket.on('teacher:quiz-set-end', (data) => {
      const { courseId } = data;
      io.to(`course:${courseId}`).emit('student:quiz-set-end', {});
    });

    // ─────────────────────────────────────────
    // 학생: 내 상태 지우기
    // ─────────────────────────────────────────
    socket.on('student:clear-state', () => {
      const student = connectedStudents.get(socket.id);
      if (!student) return;

      // 강사에게 해당 학생 상태 삭제 알림
      io.to('teacher').emit('teacher:feedback-cleared', {
        enrollmentId: student.enrollmentId,
        courseId: student.courseId,
      });
    });

    // ─────────────────────────────────────────
    // 강사: 전체 학생 상태 초기화
    // ─────────────────────────────────────────
    socket.on('teacher:clear-all', (data) => {
      const { courseId } = data;
      // 초기화 시각 DB에 기록 (리로드 후에도 초기화 상태 유지)
      db.prepare(`INSERT INTO feedback_clears (course_id) VALUES (?)`).run(courseId);
      // 해당 과정 학생 전체에게 상태 초기화 명령
      io.to(`course:${courseId}`).emit('student:state-cleared');
      // 강사에게도 전체 초기화 완료 알림
      socket.emit('teacher:all-feedback-cleared', { courseId });
    });

    // ─────────────────────────────────────────
    // 강사: 버튼 세트 변경 전달
    // ─────────────────────────────────────────
    socket.on('teacher:button-set-change', (data) => {
      const { courseId, buttonSet } = data;
      activeButtonSets.set(String(courseId), buttonSet);
      io.to(`course:${courseId}`).emit('student:button-set-change', { buttonSet });
    });

    // ─────────────────────────────────────────
    // 강사: 퀴즈 종료 전달
    // ─────────────────────────────────────────
    socket.on('teacher:quiz-end', (data) => {
      const { courseId, sessionId } = data;
      io.to(`course:${courseId}`).emit('student:quiz-end', { sessionId });
    });

    // ─────────────────────────────────────────
    // 강사: 도움요청 처리 완료
    // ─────────────────────────────────────────
    socket.on('teacher:help-done', (data) => {
      const { helpId } = data;
      db.prepare(`UPDATE help_requests SET status = 'done' WHERE id = ?`).run(helpId);
    });

    // ─────────────────────────────────────────
    // 강사: 익명질문 확인 처리
    // ─────────────────────────────────────────
    socket.on('teacher:question-check', (data) => {
      const { questionId } = data;
      db.prepare(`UPDATE questions_anon SET is_checked = 1 WHERE id = ?`).run(questionId);
    });

    // ─────────────────────────────────────────
    // 연결 해제
    // ─────────────────────────────────────────
    socket.on('disconnect', () => {
      const student = connectedStudents.get(socket.id);
      if (student) {
        // 강사에게 학생 퇴장 알림
        io.to('teacher').emit('teacher:student-left', {
          enrollmentId: student.enrollmentId,
          courseId: student.courseId,
        });
        connectedStudents.delete(socket.id);
        console.log(`[Socket] 학생 퇴장: ${student.name}`);
      }

      if (socket.id === teacherSocketId) {
        teacherSocketId = null;
        console.log('[Socket] 강사 연결 해제');
      }
    });
  });

  console.log('[Socket] Socket.io 초기화 완료');
}

module.exports = { initSocket };
