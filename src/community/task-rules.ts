import type { JobAnalysis, Language, Urgency } from './types';

export const QUICK_PICK_IDS = ['light-bulb', 'water-plants', 'groceries', 'move-furniture', 'grab-bar', 'tech-help', 'smoke-alarm', 'yard'] as const;
export type QuickPickId = typeof QUICK_PICK_IDS[number];
type PatternId = QuickPickId | 'rug' | 'night-light' | 'clutter' | 'plumbing' | 'company' | 'general';
type Phrases = Record<Language, string>;
type Template = Pick<JobAnalysis, 'category' | 'skills' | 'tools' | 'estimatedMinutes' | 'peopleNeeded' | 'safetyNotes'> & { titles: Phrases; summary: string };
const TEMPLATES: Record<PatternId, Template> = {
  'light-bulb': {
    titles: { en: 'Replace a light bulb', es: 'Cambiar una bombilla', ko: '전구 교체하기', zh: '更换灯泡', vi: 'Thay bóng đèn', tl: 'Palitan ang bumbilya', ru: 'Заменить лампочку', fr: 'Remplacer une ampoule', ar: 'تغيير مصباح الإضاءة' },
    summary: 'Help replace a light bulb that is difficult to reach.', category: 'repair', skills: ['electrical-basic'], tools: ['ladder'], estimatedMinutes: 20, peopleNeeded: 1,
    safetyNotes: ['Switch the light off and let the bulb cool. Use a stable ladder; stop if wiring needs attention.'],
  },
  'water-plants': {
    titles: { en: 'Water the plants', es: 'Regar las plantas', ko: '화분에 물 주기', zh: '给植物浇水', vi: 'Tưới cây', tl: 'Diligan ang mga halaman', ru: 'Полить растения', fr: 'Arroser les plantes', ar: 'سقي النباتات' },
    summary: 'Help water household plants.', category: 'household', skills: ['general'], tools: ['watering-can'], estimatedMinutes: 20, peopleNeeded: 1, safetyNotes: ['Wipe up any spilled water.'],
  },
  groceries: {
    titles: { en: 'Pick up groceries', es: 'Hacer la compra', ko: '장보기 도와주기', zh: '帮忙买菜', vi: 'Mua thực phẩm', tl: 'Mamili ng pagkain', ru: 'Купить продукты', fr: 'Faire les courses', ar: 'شراء البقالة' },
    summary: 'Help pick up groceries and bring them home.', category: 'errand', skills: ['errands'], tools: ['car'], estimatedMinutes: 60, peopleNeeded: 1, safetyNotes: ['Agree on the shopping list and payment before the trip.'],
  },
  'move-furniture': {
    titles: { en: 'Move furniture', es: 'Mover un mueble', ko: '가구 옮기기', zh: '搬动家具', vi: 'Di chuyển đồ nội thất', tl: 'Ilipat ang muwebles', ru: 'Передвинуть мебель', fr: 'Déplacer un meuble', ar: 'نقل الأثاث' },
    summary: 'Help move furniture with two people and a clear path.', category: 'moving', skills: ['lifting'], tools: ['gloves'], estimatedMinutes: 45, peopleNeeded: 2, safetyNotes: ['Two people should assess the load first. Do not lift more than you can manage.'],
  },
  'grab-bar': {
    titles: { en: 'Install a grab bar', es: 'Instalar una barra de apoyo', ko: '안전 손잡이 설치하기', zh: '安装扶手', vi: 'Lắp thanh vịn', tl: 'Magkabit ng hawakang pangsuporta', ru: 'Установить поручень', fr: 'Installer une barre d’appui', ar: 'تركيب مقبض دعم' },
    summary: 'Ask for help planning and installing a grab bar with suitable wall support.', category: 'safety', skills: ['safety-install'], tools: ['drill', 'stud-finder', 'level'], estimatedMinutes: 60, peopleNeeded: 2,
    safetyNotes: ['Check wall support and the manufacturer’s instructions. Ask a qualified installer if secure mounting is uncertain.'],
  },
  'tech-help': {
    titles: { en: 'Help with a phone or computer', es: 'Ayuda con el teléfono o la computadora', ko: '휴대폰이나 컴퓨터 사용 돕기', zh: '帮助使用手机或电脑', vi: 'Hỗ trợ điện thoại hoặc máy tính', tl: 'Tulong sa telepono o computer', ru: 'Помочь с телефоном или компьютером', fr: 'Aider avec un téléphone ou un ordinateur', ar: 'المساعدة في الهاتف أو الكمبيوتر' },
    summary: 'Help with a phone, computer or everyday technology.', category: 'tech', skills: ['tech-help'], tools: [], estimatedMinutes: 30, peopleNeeded: 1, safetyNotes: ['Keep passwords and financial details private.'],
  },
  'smoke-alarm': {
    titles: { en: 'Check a smoke alarm', es: 'Revisar un detector de humo', ko: '화재경보기 점검하기', zh: '检查烟雾报警器', vi: 'Kiểm tra báo khói', tl: 'Suriin ang smoke alarm', ru: 'Проверить дымовой извещатель', fr: 'Vérifier un détecteur de fumée', ar: 'فحص كاشف الدخان' },
    summary: 'Help check a smoke alarm and replace its battery if appropriate.', category: 'safety', skills: ['electrical-basic'], tools: ['ladder', 'screwdriver-set'], estimatedMinutes: 30, peopleNeeded: 1,
    safetyNotes: ['Follow the alarm instructions. Leave hardwired repairs to a qualified electrician. If there is smoke or fire, leave and call emergency services.'],
  },
  yard: {
    titles: { en: 'Help in the yard', es: 'Ayuda con el jardín', ko: '마당 정리하기', zh: '帮忙整理院子', vi: 'Dọn sân vườn', tl: 'Tumulong sa bakuran', ru: 'Помочь во дворе', fr: 'Aider au jardin', ar: 'المساعدة في الحديقة' },
    summary: 'Help with light yard work and clearing leaves.', category: 'yard', skills: ['yard'], tools: ['gloves'], estimatedMinutes: 60, peopleNeeded: 1, safetyNotes: ['Wear gloves and take breaks. Leave tree work and power equipment to qualified help.'],
  },
  rug: {
    titles: { en: 'Secure or remove a loose rug', es: 'Fijar o quitar una alfombra suelta', ko: '미끄러운 러그 고정하거나 치우기', zh: '固定或移走松动的地毯', vi: 'Cố định hoặc cất thảm lỏng', tl: 'Ikabit o alisin ang maluwag na alpombra', ru: 'Закрепить или убрать скользящий коврик', fr: 'Fixer ou enlever un tapis mobile', ar: 'تثبيت سجادة غير ثابتة أو إزالتها' },
    summary: 'Help secure or remove a loose rug after reviewing the spot together.', category: 'safety', skills: ['general'], tools: [], estimatedMinutes: 20, peopleNeeded: 1, safetyNotes: ['Keep the walkway clear while moving the rug.'],
  },
  'night-light': {
    titles: { en: 'Install night lights', es: 'Instalar luces nocturnas', ko: '야간 조명 설치하기', zh: '安装夜灯', vi: 'Lắp đèn ngủ', tl: 'Maglagay ng ilaw sa gabi', ru: 'Установить ночники', fr: 'Installer des veilleuses', ar: 'تركيب إضاءة ليلية' },
    summary: 'Help add night lights along the usual walking path.', category: 'safety', skills: ['general'], tools: [], estimatedMinutes: 20, peopleNeeded: 1, safetyNotes: ['Use suitable plug-in or battery lights. Keep cords out of walking paths.'],
  },
  clutter: {
    titles: { en: 'Clear a walkway', es: 'Despejar una zona de paso', ko: '통로 정리하기', zh: '清理走道', vi: 'Dọn lối đi', tl: 'Linisin ang daanan', ru: 'Освободить проход', fr: 'Dégager un passage', ar: 'إخلاء الممر' },
    summary: 'Help move clutter out of a walking path with the resident’s permission.', category: 'household', skills: ['cleaning'], tools: ['gloves'], estimatedMinutes: 30, peopleNeeded: 1, safetyNotes: ['Ask before moving or discarding belongings. Leave heavy items for additional help.'],
  },
  plumbing: {
    titles: { en: 'Review a leaking tap', es: 'Revisar un grifo que gotea', ko: '물이 새는 수도꼭지 살펴보기', zh: '查看漏水的水龙头', vi: 'Kiểm tra vòi nước bị rò', tl: 'Suriin ang tumutulong gripo', ru: 'Осмотреть протекающий кран', fr: 'Examiner un robinet qui fuit', ar: 'فحص صنبور يتسرب منه الماء' },
    summary: 'Help review a dripping tap and decide whether a plumber is needed.', category: 'repair', skills: ['plumbing-basic'], tools: ['pliers'], estimatedMinutes: 45, peopleNeeded: 1, safetyNotes: ['Locate the water shutoff. Stop and ask a plumber if the repair is uncertain.'],
  },
  company: {
    titles: { en: 'Spend some time together', es: 'Pasar un rato juntos', ko: '함께 시간 보내기', zh: '一起聊聊天', vi: 'Dành thời gian trò chuyện', tl: 'Maglaan ng oras na magkasama', ru: 'Провести время вместе', fr: 'Passer un moment ensemble', ar: 'قضاء بعض الوقت معًا' },
    summary: 'Arrange a friendly visit or conversation.', category: 'companionship', skills: ['companionship'], tools: [], estimatedMinutes: 60, peopleNeeded: 1, safetyNotes: ['Agree on the visit and let a trusted person know the plan.'],
  },
  general: {
    titles: { en: 'Help with a household task', es: 'Ayuda con una tarea del hogar', ko: '집안일 도움 요청하기', zh: '请求家务帮助', vi: 'Hỗ trợ việc nhà', tl: 'Tulong sa gawaing bahay', ru: 'Помочь с домашним делом', fr: 'Aider pour une tâche à la maison', ar: 'المساعدة في مهمة منزلية' },
    summary: 'Review the request together and agree on the task, tools and time before starting.', category: 'household', skills: ['general'], tools: [], estimatedMinutes: 30, peopleNeeded: 1, safetyNotes: ['Review the task together before starting. Ask for qualified help when needed.'],
  },
};
// Each pattern includes English, Spanish, Korean, Chinese and Vietnamese; the other languages are best effort.
const PATTERNS: readonly [PatternId, RegExp][] = [
  ['grab-bar', /grab.?bar|handrail|barra de apoyo|pasamanos|손잡이|扶手|thanh vịn|tay vịn|hawakan|поручень|barre d.appui|مقبض دعم/iu],
  ['smoke-alarm', /smoke|carbon monoxide|detector de humo|화재|경보기|烟雾|煙霧|báo khói|báo cháy|usok|дым|détecteur|كاشف الدخان/iu],
  ['night-light', /night.?light|night lighting|luz nocturna|luces nocturnas|야간|밤.*조명|夜灯|夜燈|đèn ngủ|ilaw sa gabi|ночник|veilleuse|إضاءة ليلية/iu],
  ['light-bulb', /light.?bulb|bulb|burned out|bombilla|foco|전구|灯泡|燈泡|bóng đèn|bumbilya|лампочк|ampoule|مصباح/iu],
  ['rug', /rug|loose carpet|alfombra|러그|깔개|地毯|thảm|alpombra|коврик|tapis|سجادة/iu],
  ['clutter', /clutter|walkway|clear.*path|despejar|통로|走道|杂物|雜物|lối đi|daanan|проход|passage|الممر/iu],
  ['move-furniture', /furniture|sofa|couch|move.*(?:table|bed|chair)|mueble|가구|소파|家具|沙发|沙發|nội thất|bàn ghế|muwebles|мебель|meuble|أثاث|الأثاث/iu],
  ['water-plants', /plant|water.*flower|regar|planta|화분|식물|浇水|澆水|植物|tưới|diligan|растени|arroser|سقي|النبات/iu],
  ['groceries', /grocer|shopping|food shop|compra|comestible|장보|장봐|식료품|买菜|買菜|购物|購物|thực phẩm|đi chợ|pagkain|продукт|courses|بقالة|البقالة/iu],
  ['tech-help', /phone|computer|wifi|wi-fi|printer|teléfono|telefono|computadora|휴대폰|컴퓨터|스마트폰|手机|手機|电脑|電腦|điện thoại|máy tính|telepono|телефон|компьютер|téléphone|ordinateur|الهاتف|كمبيوتر/iu],
  ['yard', /yard|leaves|garden|jardín|jardin|마당|정원|院子|庭院|sân|vườn|bakuran|двор|jardin|حديقة|الحديقة/iu],
  ['plumbing', /leak|faucet|tap drip|grifo|gotea|수도꼭지|물이 새|漏水|水龙头|rò|vòi|gripo|кран|robinet|صنبور/iu],
  ['company', /compan|visit|lonely|visita|외로|말벗|聊天|陪伴|trò chuyện|kausap|поговор|ensemble|معًا/iu],
];
function localizedSummary(title: string, language: Language): string {
  const phrases: Phrases = {
    en: `Please help with this task: ${title}.`, es: `Necesito ayuda con esta tarea: ${title}.`, ko: `도움이 필요해요: ${title}.`,
    zh: `我需要帮助：${title}。`, vi: `Tôi cần hỗ trợ việc này: ${title}.`, tl: `Kailangan ko ng tulong: ${title}.`,
    ru: `Нужна помощь: ${title}.`, fr: `J’ai besoin d’aide pour cette tâche : ${title}.`, ar: `أحتاج إلى مساعدة في هذه المهمة: ${title}.`,
  };
  return phrases[language];
}
function analysisFor(id: PatternId, language: Language): JobAnalysis {
  const t = TEMPLATES[id];
  return { title: t.titles[language], titleEnglish: t.titles.en, summary: language === 'en' ? t.summary : localizedSummary(t.titles[language], language), summaryEnglish: t.summary,
    category: t.category, skills: [...t.skills], tools: [...t.tools], estimatedMinutes: t.estimatedMinutes, peopleNeeded: t.peopleNeeded, urgency: 'this-week', safetyNotes: [...t.safetyNotes], language, engine: 'rules' };
}
export function quickPickAnalysis(id: QuickPickId, language: Language): JobAnalysis { return analysisFor(id, language); }
// Match whole words for spaced scripts, rather than substrings such as hoya/ngayđó.
// CJK/Korean expressions use explicit phrases and suffixes.
const NEGATED_URGENCY = /(?:^|[^\p{L}\p{N}])(?:not\s+urgent|no\s+rush|no\s+(?:es\s+)?urgente|sin\s+(?:prisa|urgencia)|không\s+(?:vội|khẩn cấp)|hindi\s+(?:agaran|apurahan)|не\s+срочно|sans\s+urgence|pas\s+urgent|غير\s+عاجل|ليس\s+عاجل(?:اً|ا)?)(?![\p{L}\p{N}])|급하지\s*않[가-힣]*|不(?:着急|著急|紧急|緊急|急)/giu;
const NEGATED_TODAY = /(?:^|[^\p{L}\p{N}])(?:not\s+today|no\s+hoy|không\s+phải\s+hôm nay|hindi\s+ngayon|не\s+сегодня|pas\s+aujourd['’]hui|ليس\s+اليوم)(?![\p{L}\p{N}])|오늘\s*(?:말고|아니[가-힣]*)|不是今天/giu;
const POSITIVE_URGENCY = /(?:^|[^\p{L}\p{N}])(?:today|urgent|urgente|hoy|hôm nay|ngay|khẩn cấp|ngayon|agaran|сегодня|срочно|aujourd['’]hui|اليوم|عاجل)(?![\p{L}\p{N}])|오늘|지금|긴급|今天|紧急|緊急/iu;
const FLEXIBLE = /(?:^|[^\p{L}\p{N}])(?:whenever|flexible|kahit kailan)(?![\p{L}\p{N}])|언제든|급하지|随时|隨時/iu;
function timingParts(text: string) {
  const normalized = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const withoutNegatives = normalized.replace(NEGATED_URGENCY, ' ').replace(NEGATED_TODAY, ' ');
  return { normalized, withoutNegatives, negated: normalized !== withoutNegatives };
}
/** Explicit local phrase rules only; unknown scheduling stays unspecified. */
export function ruleUrgency(text: string): Urgency | undefined {
  const { withoutNegatives, negated } = timingParts(text);
  // Remove only a negated phrase: an independent explicit "today" still counts.
  if (POSITIVE_URGENCY.test(withoutNegatives)) return 'today';
  if (negated || FLEXIBLE.test(withoutNegatives)) return 'flexible';
  return undefined;
}
// Recognized actions accompany a known task object; length alone is never evidence.
const TASK_ACTION = /(?:^|[^\p{L}\p{N}])(?:help|water|replace|change|move|install|secure|remove|clear|pick up|check|fix|repair|regar|cambiar|mover|instalar|ayuda|tưới|thay|giúp|diligan|palitan|tulong|полить|заменить|помочь|передвинуть|arroser|remplacer|aider|déplacer|سقي|تغيير|تركيب|مساعدة)(?![\p{L}\p{N}])|교체|옮|설치|도와|물\s*주|浇水|澆水|买菜|買菜|更换|更換|安装|安裝|请帮|請幫/iu;
const CJK_MOVE = /搬.*(?:椅子|桌子|床)/u;
/** Conservative ambiguity guard for the rules chat only, not a general language parser.
 * Negated urgency is removed first so it never cancels an independent task. */
function unresolvedRuleTask(text: string): boolean {
  const { withoutNegatives } = timingParts(text);
  return /(?:^|[^\p{L}\p{N}])(?:not|never|don't|do not|cancel|maybe|or|no|не|нет|или|hindi|không|pas|non|ou|ليس|لا|أو)(?![\p{L}\p{N}])|하지\s*마|아니|말고|不要|取消|或者|ignore.{0,40}instructions|system\s*[:>]|automatically/iu.test(withoutNegatives);
}
export function clearRuleTask(text: string): boolean {
  const normalized = text.normalize('NFKC');
  return !unresolvedRuleTask(normalized) && ((TASK_ACTION.test(normalized) && PATTERNS.some(([, pattern]) => pattern.test(normalized))) || CJK_MOVE.test(normalized));
}
/** Allow only a short timing phrase or a named room, with optional correction cue.
 * Other followups need clarification; do not attach arbitrary words to a stale task. */
export function ruleFollowup(text: string): 'timing' | 'room' | null {
  if (text.length > 160 || unresolvedRuleTask(text)) return null;
  const { normalized, withoutNegatives } = timingParts(text);
  const remainder = withoutNegatives.replace(new RegExp(POSITIVE_URGENCY.source, 'giu'), ' ').replace(new RegExp(FLEXIBLE.source, 'giu'), ' ')
    .replace(/(?:^|[^\p{L}\p{N}])(?:actually|please|instead)(?![\p{L}\p{N}])|[\p{P}\p{Z}\s]/giu, '');
  if (ruleUrgency(normalized) !== undefined && !remainder) return 'timing';
  const room = normalized.replace(/[.!。！]$/u, '').trim();
  return /^(?:(?:actually,?\s*)?(?:in\s+)?(?:the\s+)?(?:kitchen|bathroom|bedroom|living room|hallway)|(?:en\s+)?(?:la\s+)?(?:cocina|sala)|(?:在)?(?:厨房|廚房|客厅|客廳)|(?:부엌|거실)(?:에서|에)?|(?:ở\s+)?(?:nhà bếp|phòng khách)|(?:sa\s+)?(?:kusina|sala)|(?:на\s+)?кухне|(?:в\s+)?гостиной|(?:dans\s+la\s+)?cuisine|(?:في\s+)?(?:المطبخ|غرفة المعيشة))$/iu.test(room) ? 'room' : null;
}
export function analyzeTaskWithRules(text: string, language: Language): JobAnalysis {
  const normalized = text.normalize('NFKC').trim();
  const id = PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? (CJK_MOVE.test(normalized) ? 'move-furniture' : 'general');
  const result = analysisFor(id, language);
  result.urgency = ruleUrgency(normalized) ?? result.urgency;
  return result;
}
/** A draft request from a flag, never confirmation that a hazard exists or a repair is safe. */
export function scanFlagAnalysis(checklistItemId: string, label: string, language: Language): JobAnalysis {
  const id = checklistItemId.toLowerCase();
  const pattern: PatternId = /rug|carpet/.test(id) ? 'rug' : /night|light/.test(id) ? 'night-light'
    : /grab|handrail/.test(id) ? 'grab-bar' : /clutter|walkway|cord|path|floor/.test(id) ? 'clutter'
      : /smoke|alarm/.test(id) ? 'smoke-alarm' : 'general';
  const result = analysisFor(pattern, language);
  if (pattern === 'general') {
    const safeLabel = label.trim().slice(0, 160);
    result.summaryEnglish = safeLabel ? `Review this area with the resident: ${safeLabel}. Agree on any help needed.` : 'Review this area with the resident and agree on any help needed.';
    if (language === 'en') result.summary = result.summaryEnglish;
    result.category = 'safety';
  }
  return { ...result, safetyNotes: [...result.safetyNotes, 'This draft comes from an unverified room flag. Review the spot with the resident before acting.'] };
}
