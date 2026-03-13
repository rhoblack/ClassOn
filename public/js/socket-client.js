// ClassOn Socket.io 클라이언트 유틸리티
// 강사/학생 공통으로 사용

/**
 * Socket.io 연결 및 이벤트 헬퍼
 * 사용법:
 *   const socket = SocketClient.connect();
 *   SocketClient.onFeedback((data) => { ... });
 */
const SocketClient = {
  socket: null,
  _reconnectCb: null,  // 재연결 시 실행할 콜백

  /**
   * 서버에 연결
   */
  _firstConnect: true,

  connect() {
    if (this.socket && this.socket.connected) return this.socket;
    this._firstConnect = true;
    this.socket = io({ reconnection: true, reconnectionDelay: 1000 });
    this.socket.on('connect', () => {
      console.log('[Socket] 연결됨:', this.socket.id);
      if (!this._firstConnect && this._reconnectCb) {
        // 재연결 시 콜백 실행
        this._reconnectCb();
      }
      this._firstConnect = false;
    });
    this.socket.on('disconnect', () => {
      console.log('[Socket] 연결 해제됨');
    });
    this.socket.on('error', (err) => {
      console.error('[Socket] 오류:', err);
    });
    return this.socket;
  },

  /** 재연결 콜백 등록 */
  onReconnect(cb) { this._reconnectCb = cb; },

  /**
   * 강사 등록
   */
  registerTeacher() {
    this.socket.emit('teacher:register');
  },

  /**
   * 학생 입장
   */
  joinAsStudent(enrollmentId, courseId) {
    this.socket.emit('student:join', { enrollmentId, courseId });
  },

  /**
   * 학생: 피드백 전송 (acknowledgment + retry)
   * - 서버 확인 응답 후 onSuccess 콜백 실행
   * - 0.5초 내 응답 없으면 최대 3회 재시도
   * - 3회 모두 실패하면 onSuccess 미호출 (UI 업데이트 없음)
   */
  sendFeedback(enrollmentId, courseId, buttonSetId, buttonIndex, color, emoji, label, onSuccess) {
    // 이전 재시도 취소
    if (this._feedbackCancel) this._feedbackCancel();

    const data = { enrollmentId, courseId, buttonSetId, buttonIndex, color, emoji, label };
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 500;
    let attempts = 0;
    let cancelled = false;
    let retryTimer = null;

    this._feedbackCancel = () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };

    const attempt = () => {
      if (cancelled) return;
      attempts++;
      this.socket.timeout(TIMEOUT_MS).emit('student:feedback', data, (err, res) => {
        if (cancelled) return;
        if (!err && res?.success) {
          if (typeof onSuccess === 'function') onSuccess();
          this._feedbackCancel = null;
          return;
        }
        if (attempts < MAX_RETRIES) {
          retryTimer = setTimeout(attempt, TIMEOUT_MS);
        }
        // 3회 모두 실패 → UI 업데이트 없이 종료
      });
    };

    attempt();
  },

  /**
   * 학생: 익명 질문 전송
   */
  sendQuestion(enrollmentId, courseId, text) {
    this.socket.emit('student:question', { enrollmentId, courseId, text });
  },

  /**
   * 학생: 도움 요청
   */
  sendHelpRequest(enrollmentId, courseId) {
    this.socket.emit('student:help-request', { enrollmentId, courseId });
  },

  /**
   * 학생: 퀴즈 응답
   */
  sendQuizAnswer(sessionId, enrollmentId, answer) {
    this.socket.emit('student:quiz-answer', { sessionId, enrollmentId, answer });
  },

  /**
   * 강사: 공지 전송
   */
  sendNotice(courseId, text, links) {
    this.socket.emit('teacher:send-notice', { courseId, text, links });
  },

  /**
   * 강사: 도움 요청 완료 처리
   */
  helpDone(helpId) {
    this.socket.emit('teacher:help-done', { helpId });
  },

  /**
   * 강사: 익명 질문 확인 처리
   */
  checkQuestion(questionId) {
    this.socket.emit('teacher:question-check', { questionId });
  },

  /**
   * 학생: 내 상태 지우기
   */
  clearMyState() {
    this.socket.emit('student:clear-state');
  },

  /**
   * 강사: 전체 학생 상태 초기화
   */
  clearAllStates(courseId) {
    this.socket.emit('teacher:clear-all', { courseId });
  },

  /**
   * 강사: 버튼 세트 변경 알림
   */
  changeButtonSet(courseId, buttonSet) {
    this.socket.emit('teacher:button-set-change', { courseId, buttonSet });
  },

  // ─── 이벤트 리스너 (강사 화면용) ───────────────────────────

  onSync(cb)                { this.socket.on('teacher:sync', cb); },
  onStudentJoined(cb)       { this.socket.on('teacher:student-joined', cb); },
  onStudentLeft(cb)         { this.socket.on('teacher:student-left', cb); },
  onFeedbackUpdate(cb)      { this.socket.on('teacher:feedback-update', cb); },
  onFeedbackCleared(cb)     { this.socket.on('teacher:feedback-cleared', cb); },
  onAllFeedbackCleared(cb)  { this.socket.on('teacher:all-feedback-cleared', cb); },
  onQuestionReceived(cb)    { this.socket.on('teacher:question-received', cb); },
  onHelpRequested(cb)       { this.socket.on('teacher:help-requested', cb); },
  onQuizAnswerUpdate(cb)    { this.socket.on('teacher:quiz-answer-update', cb); },

  // ─── 이벤트 리스너 (학생 화면용) ───────────────────────────

  onQuizStart(cb)     { this.socket.on('student:quiz-start', cb); },
  onQuizEnd(cb)       { this.socket.on('student:quiz-end', cb); },
  onNotice(cb)        { this.socket.on('student:notice', cb); },
  onStateClear(cb)       { this.socket.on('student:state-cleared', cb); },
  onButtonSetChange(cb)  { this.socket.on('student:button-set-change', cb); },
};
