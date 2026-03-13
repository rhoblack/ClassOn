// ClassOn 모듈 ON/OFF 설정
// 기능 추가: 모듈 폴더 생성 후 여기서 true
// 기능 비활성화: false로 변경 (코드 삭제 불필요)
module.exports = {
  feedback:  true,   // 실시간 피드백
  quiz:      true,   // 퀴즈 & 성취도
  students:  true,   // 학생 관리
  courses:   true,   // 과정(코호트) 관리
  questions: true,   // 문제 은행
  teams:     true,   // 팀 편성
  layout:    true,   // 교실 레이아웃
  system:    true,   // 시스템 운영

  // 추후 추가 예정
  // attendance_report: false,  // 출석 리포트
  // lecture_note:      false,  // 수업 노트
};
