// ClassOn 공통 JS 유틸리티
// API 헬퍼, 토스트 알림, 공통 함수

// ============================================================
// API 헬퍼
// ============================================================
const API = {
  /**
   * GET 요청
   */
  async get(url) {
    const res = await fetch(url);
    if (!res.ok && res.status === 401) {
      window.location.href = '/login';
      return;
    }
    return res.json();
  },

  /**
   * POST 요청
   */
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok && res.status === 401) {
      window.location.href = '/login';
      return;
    }
    return res.json();
  },

  /**
   * PUT 요청
   */
  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  /**
   * DELETE 요청
   */
  async delete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  },

  /**
   * 파일 업로드 (FormData)
   */
  async upload(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
};

// ============================================================
// 토스트 알림
// ============================================================
const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'default', duration = 3000) {
    this.init();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all .2s';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
};

// ============================================================
// 모달 관리
// ============================================================
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
  },
};

// 모달 오버레이 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ============================================================
// 탭 관리
// ============================================================
function initTabs(container) {
  const el = container || document;
  el.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabGroup = btn.closest('[data-tabs]') || btn.closest('.tabs').parentElement;
      const target = btn.dataset.tab;

      // 버튼 활성화
      tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 패널 표시
      tabGroup.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      const pane = tabGroup.querySelector(`[data-tab-pane="${target}"]`);
      if (pane) pane.classList.add('active');
    });
  });
}

// ============================================================
// 유틸 함수
// ============================================================

/**
 * 날짜 포맷: YYYY-MM-DD → YYYY.MM.DD
 */
function formatDate(str) {
  if (!str) return '-';
  return str.slice(0, 10).replace(/-/g, '.');
}

/**
 * 숫자 퍼센트 표시: 85 → 85%
 */
function fmtPct(n) {
  if (n === null || n === undefined) return '-';
  return Math.round(n) + '%';
}

/**
 * 성취도 레벨 (색상 클래스 반환)
 */
function achievementClass(n) {
  if (n >= 80) return 'badge-green';
  if (n >= 60) return 'badge-blue';
  if (n >= 40) return 'badge-yellow';
  return 'badge-red';
}

/**
 * 성취도 레이블
 */
function achievementLabel(n) {
  if (n >= 80) return '우수';
  if (n >= 60) return '양호';
  if (n >= 40) return '보통';
  return '관리필요';
}

/**
 * 로그아웃
 */
async function logout() {
  await API.post('/api/auth/logout');
  window.location.href = '/login';
}

/**
 * 현재 선택된 과정 ID를 로컬스토리지에서 가져오기
 */
function getCurrentCourseId() {
  return localStorage.getItem('currentCourseId');
}

/**
 * 현재 선택된 과정 ID 저장
 */
function setCurrentCourseId(id) {
  localStorage.setItem('currentCourseId', id);
}

/**
 * 현재 선택된 과정 정보 조회
 */
async function loadCurrentCourse() {
  const id = getCurrentCourseId();
  if (!id) return null;
  const res = await API.get(`/api/courses/${id}`);
  return res && res.success ? res.data : null;
}

/**
 * 사이드바 접기/펼치기 (localStorage 상태 저장)
 */
function toggleSidebar() {
  const layout = document.querySelector('.teacher-layout, .class-layout');
  if (!layout) return;
  const collapsed = layout.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

// DOM 준비 시 탭 초기화 + 사이드바 상태 복원
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    const layout = document.querySelector('.teacher-layout, .class-layout');
    if (layout) layout.classList.add('sidebar-collapsed');
  }
});
