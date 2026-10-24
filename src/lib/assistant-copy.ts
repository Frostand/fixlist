import type { Language } from '../domain/roles';

/** Authored rules-mode labels, not runtime translations or a fluency claim. */
export const assistantRulesCopy: Record<Language, string> = {
  en: 'Using local task rules. Review and edit the draft before posting.',
  es: 'Se usan reglas locales para tareas. Revise y edite el borrador antes de publicarlo.',
  zh: '正在使用本地任务规则。发布前请检查并编辑草稿。',
  vi: 'Đang dùng quy tắc tác vụ trên thiết bị. Hãy xem lại và sửa bản nháp trước khi đăng.',
  ko: '기기의 작업 규칙을 사용합니다. 게시 전에 초안을 검토하고 수정하세요.',
  tl: 'Gumagamit ng mga lokal na tuntunin sa gawain. Suriin at i-edit ang draft bago i-post.',
  ru: 'Используются локальные правила задач. Проверьте и исправьте черновик перед публикацией.',
  fr: 'Des règles locales sont utilisées. Vérifiez et modifiez le brouillon avant de le publier.',
  ar: 'تُستخدم قواعد المهام المحلية. راجع المسودة وعدّلها قبل النشر.',
};
