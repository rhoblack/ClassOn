// 시스템 운영 API 라우터
// DB 백업, 비밀번호 변경

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth, changePassword } = require('../../core/auth');

router.use(requireAuth);

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'classson.db');
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backup');

// ─────────────────────────────────────────
// POST /api/system/backup — DB 백업
// ─────────────────────────────────────────
router.post('/system/backup', (req, res) => {
  if (!fs.existsSync(DB_PATH)) {
    return res.status(404).json({ success: false, message: 'DB 파일을 찾을 수 없습니다.' });
  }

  // backup 폴더 생성
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // 날짜별 파일명
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const fileName = `classson_backup_${dateStr}_${timeStr}.db`;
  const destPath = path.join(BACKUP_DIR, fileName);

  try {
    fs.copyFileSync(DB_PATH, destPath);

    // 마지막 백업 시각 갱신 (system_config에 저장)
    const db = require('../../core/database');
    db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value) VALUES ('last_backup', ?)
    `).run(now.toISOString());

    res.json({
      success: true,
      message: '백업이 완료되었습니다.',
      fileName,
      path: destPath,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: '백업 실패: ' + e.message });
  }
});

// ─────────────────────────────────────────
// GET /api/system/backup/list — 백업 파일 목록
// ─────────────────────────────────────────
router.get('/system/backup/list', (req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) {
    return res.json({ success: true, data: [] });
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        name: f,
        size: stat.size,
        created: stat.birthtime,
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  // 마지막 백업 시각
  const db = require('../../core/database');
  const lastBackup = db.prepare("SELECT value FROM system_config WHERE key = 'last_backup'").get();

  res.json({
    success: true,
    data: files,
    lastBackup: lastBackup ? lastBackup.value : null,
    backupDir: BACKUP_DIR,
  });
});

// ─────────────────────────────────────────
// POST /api/system/change-password — 비밀번호 변경
// ─────────────────────────────────────────
router.post('/system/change-password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({ success: false, message: '새 비밀번호가 일치하지 않습니다.' });
  }

  const result = changePassword(current_password, new_password);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// ─────────────────────────────────────────
// GET /api/system/info — 서버 정보
// ─────────────────────────────────────────
router.get('/system/info', (req, res) => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  // 모든 비내부 IPv4 주소 수집 (인터페이스 이름 포함)
  const ipList = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const net of addrs) {
      if (net.family === 'IPv4' && !net.internal && !name.toLowerCase().startsWith('vethernet')) {
        ipList.push({ name, address: net.address });
      }
    }
  }

  const primaryIP = ipList.length > 0 ? ipList[0].address : 'localhost';

  const db = require('../../core/database');
  const lastBackup = db.prepare("SELECT value FROM system_config WHERE key = 'last_backup'").get();

  // DB 파일 크기
  let dbSize = 0;
  if (fs.existsSync(DB_PATH)) {
    dbSize = fs.statSync(DB_PATH).size;
  }

  res.json({
    success: true,
    data: {
      localIP: primaryIP,
      ipList,
      port: 3000,
      studentUrl: `http://${primaryIP}:3000/student`,
      lastBackup: lastBackup ? lastBackup.value : null,
      dbSize,
      backupDir: BACKUP_DIR,
    }
  });
});

module.exports = router;
