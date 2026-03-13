const db = require('./core/database');
const bcrypt = require('bcryptjs');

const hash = bcrypt.hashSync('admin1234', 10);
db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(hash, 'password');
console.log('[완료] 비밀번호가 admin1234 로 초기화되었습니다.');
console.log('       로그인 후 설정 탭에서 새 비밀번호로 변경하세요.');
