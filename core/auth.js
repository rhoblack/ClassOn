// ClassOn 인증 미들웨어
// 강사 로그인 세션 관리

const bcrypt = require('bcryptjs');
const db = require('./database');

// ============================================================
// 세션 기반 강사 인증 미들웨어
// ============================================================

/**
 * 강사 로그인 여부를 확인하는 미들웨어
 * 미로그인 시 /login으로 리다이렉트
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.isTeacher) {
    return next();
  }
  // API 요청이면 JSON 에러 반환
  // req.path는 라우터 내부 경로이므로 req.originalUrl로 체크
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  res.redirect('/login');
}

/**
 * 로그인 처리
 * @param {string} password - 입력한 비밀번호
 * @returns {{ success: boolean, message: string }}
 */
function login(password) {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('password');
  if (!row) return { success: false, message: '비밀번호 설정 오류' };

  const valid = bcrypt.compareSync(password, row.value);
  if (!valid) return { success: false, message: '비밀번호가 올바르지 않습니다.' };

  return { success: true };
}

/**
 * 비밀번호 변경
 * @param {string} currentPw - 현재 비밀번호
 * @param {string} newPw - 새 비밀번호
 * @returns {{ success: boolean, message: string }}
 */
function changePassword(currentPw, newPw) {
  // 현재 비밀번호 확인
  const result = login(currentPw);
  if (!result.success) return { success: false, message: '현재 비밀번호가 올바르지 않습니다.' };

  // 새 비밀번호 유효성
  if (!newPw || newPw.length < 4) {
    return { success: false, message: '새 비밀번호는 4자 이상이어야 합니다.' };
  }

  const hash = bcrypt.hashSync(newPw, 10);
  db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(hash, 'password');

  return { success: true, message: '비밀번호가 변경되었습니다.' };
}

module.exports = { requireAuth, login, changePassword };
