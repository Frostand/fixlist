import type { Language } from '../domain/roles';

/** Authored conversation phrases; capability labels stay separate from spoken replies. */
export const assistantConversationCopy: Record<Language, {
  question: string; greeting: string; thanks: string; clarify: string;
  ready: string; updated: string; timing: string; detail: string;
}> = {
  en: {
    question: 'What would you like help with at home?',
    greeting: "Hi, I'm the FixList assistant. What would you like help with at home?",
    thanks: "You're welcome. What would you like help with at home?",
    clarify: "Let's get that right. What would you like help with at home?",
    ready: "I've drafted that for you. Would you like to review it?",
    updated: "Got it, I've updated the draft. Would you like to review it?",
    timing: "Got it, I've updated the timing. Would you like to review the draft?",
    detail: 'Got it. Would you like to review the draft?',
  },
  es: {
    question: '¿Con qué necesita ayuda en casa?',
    greeting: 'Hola, soy el asistente de FixList. ¿Con qué necesita ayuda en casa?',
    thanks: 'De nada. ¿Con qué necesita ayuda en casa?',
    clarify: 'Vamos a aclararlo. ¿Con qué necesita ayuda en casa?',
    ready: 'Ya preparé un borrador. ¿Quiere revisarlo?',
    updated: 'Entendido, actualicé el borrador. ¿Quiere revisarlo?',
    timing: 'Entendido, actualicé el plazo. ¿Quiere revisar el borrador?',
    detail: 'Entendido. ¿Quiere revisar el borrador?',
  },
  zh: {
    question: '您需要家里哪方面的帮助？',
    greeting: '您好，我是FixList助手。您需要家里哪方面的帮助？',
    thanks: '不客气。您需要家里哪方面的帮助？',
    clarify: '我们再确认一下。您需要家里哪方面的帮助？',
    ready: '我已经写好草稿了。您想看看吗？',
    updated: '明白了，我已修改草稿。您想看看吗？',
    timing: '明白了，我已修改时间安排。您想看看草稿吗？',
    detail: '明白了。您想看看草稿吗？',
  },
  vi: {
    question: 'Bạn cần giúp việc gì ở nhà?',
    greeting: 'Xin chào, tôi là trợ lý FixList. Bạn cần giúp việc gì ở nhà?',
    thanks: 'Không có gì. Bạn cần giúp việc gì ở nhà?',
    clarify: 'Mình làm rõ lại nhé. Bạn cần giúp việc gì ở nhà?',
    ready: 'Tôi đã soạn bản nháp. Bạn muốn xem lại không?',
    updated: 'Đã rõ, tôi đã sửa bản nháp. Bạn muốn xem lại không?',
    timing: 'Đã rõ, tôi đã sửa thời gian. Bạn muốn xem lại bản nháp không?',
    detail: 'Đã rõ. Bạn muốn xem lại bản nháp không?',
  },
  ko: {
    question: '집에서 어떤 도움이 필요하세요?',
    greeting: '안녕하세요, FixList 도우미예요. 집에서 어떤 도움이 필요하세요?',
    thanks: '천만에요. 집에서 어떤 도움이 필요하세요?',
    clarify: '다시 확인할게요. 집에서 어떤 도움이 필요하세요?',
    ready: '초안을 작성했어요. 확인해 보시겠어요?',
    updated: '알겠어요, 초안을 수정했어요. 확인해 보시겠어요?',
    timing: '알겠어요, 시간을 수정했어요. 초안을 확인해 보시겠어요?',
    detail: '알겠어요. 초안을 확인해 보시겠어요?',
  },
  tl: {
    question: 'Anong tulong ang kailangan ninyo sa bahay?',
    greeting: 'Kumusta, ako ang FixList assistant. Anong tulong ang kailangan ninyo sa bahay?',
    thanks: 'Walang anuman. Anong tulong ang kailangan ninyo sa bahay?',
    clarify: 'Linawin natin. Anong tulong ang kailangan ninyo sa bahay?',
    ready: 'Nagawa ko na ang draft. Gusto ba ninyong suriin ito?',
    updated: 'Sige, binago ko na ang draft. Gusto ba ninyong suriin ito?',
    timing: 'Sige, binago ko na ang oras. Gusto ba ninyong suriin ang draft?',
    detail: 'Sige. Gusto ba ninyong suriin ang draft?',
  },
  ru: {
    question: 'С чем вам нужна помощь дома?',
    greeting: 'Здравствуйте, я помощник FixList. С чем вам нужна помощь дома?',
    thanks: 'Пожалуйста. С чем вам нужна помощь дома?',
    clarify: 'Давайте уточним. С чем вам нужна помощь дома?',
    ready: 'Черновик готов. Хотите его проверить?',
    updated: 'Понятно, черновик обновлён. Хотите его проверить?',
    timing: 'Понятно, сроки изменены. Хотите проверить черновик?',
    detail: 'Понятно. Хотите проверить черновик?',
  },
  fr: {
    question: 'De quelle aide avez-vous besoin à la maison ?',
    greeting: 'Bonjour, je suis l’assistant FixList. De quelle aide avez-vous besoin à la maison ?',
    thanks: 'Avec plaisir. De quelle aide avez-vous besoin à la maison ?',
    clarify: 'Reprenons ensemble. De quelle aide avez-vous besoin à la maison ?',
    ready: 'J’ai préparé un brouillon. Voulez-vous le relire ?',
    updated: 'D’accord, j’ai modifié le brouillon. Voulez-vous le relire ?',
    timing: 'D’accord, j’ai modifié le délai. Voulez-vous relire le brouillon ?',
    detail: 'D’accord. Voulez-vous relire le brouillon ?',
  },
  ar: {
    question: 'ما المساعدة التي تحتاج إليها في المنزل؟',
    greeting: 'مرحبًا، أنا مساعد FixList. ما المساعدة التي تحتاج إليها في المنزل؟',
    thanks: 'على الرحب والسعة. ما المساعدة التي تحتاج إليها في المنزل؟',
    clarify: 'لنوضح ذلك. ما المساعدة التي تحتاج إليها في المنزل؟',
    ready: 'أعددت مسودة لك. هل تريد مراجعتها؟',
    updated: 'حسنًا، عدّلت المسودة. هل تريد مراجعتها؟',
    timing: 'حسنًا، عدّلت التوقيت. هل تريد مراجعة المسودة؟',
    detail: 'حسنًا. هل تريد مراجعة المسودة؟',
  },
};

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

/** Authored bounded followups. User quotations stay verbatim, not claimed translations. */
interface FollowupCopy {
  questions: Record<'object' | 'outcome' | 'location' | 'destination' | 'quantity' | 'timing' | 'access' | 'correction' | 'review', string>;
  labels: Record<'object' | 'outcome' | 'location' | 'origin' | 'destination' | 'quantity' | 'timing' | 'access', string>;
  unsupported: string; cancelled: string; context: string; emergency: string;
}
export const assistantFollowupCopy: Record<Language, FollowupCopy> = {
  en: {
    questions: { object: 'What would you like to move?', outcome: 'What would you like to do with it?', location: 'Which room do you mean?', destination: 'Where should it go?', quantity: 'How many do you mean?', timing: 'What timing should I include?', access: 'What access instructions should I include?', correction: 'Which detail would you like to change?', review: 'Would you like to review the draft?' },
    labels: { object: 'Item', outcome: 'Requested help', location: 'Room', origin: 'From', destination: 'Destination', quantity: 'Quantity', timing: 'Timing', access: 'Access' },
    unsupported: "I didn't understand that detail. ", cancelled: 'I cancelled this draft. You can start a new request.', context: 'This conversation is too long to use safely. Please start a new request with the details you want included.',
    emergency: 'If there is immediate danger or a medical emergency, move to safety if you can and contact local emergency services. FixList cannot provide emergency help.',
  },
  es: {
    questions: { object: '¿Qué quiere mover?', outcome: '¿Qué quiere hacer con él?', location: '¿A qué habitación se refiere?', destination: '¿Adónde debe ir?', quantity: '¿Cuántos son?', timing: '¿Qué plazo debo incluir?', access: '¿Qué instrucciones de acceso debo incluir?', correction: '¿Qué detalle quiere cambiar?', review: '¿Quiere revisar el borrador?' },
    labels: { object: 'Objeto', outcome: 'Ayuda solicitada', location: 'Habitación', origin: 'Desde', destination: 'Destino', quantity: 'Cantidad', timing: 'Plazo', access: 'Acceso' },
    unsupported: 'No entendí ese detalle. ', cancelled: 'Cancelé este borrador. Puede empezar otra solicitud.', context: 'La conversación es demasiado larga. Empiece otra solicitud con los detalles que quiere incluir.', emergency: 'Si hay peligro inmediato o una emergencia médica, póngase a salvo si puede y contacte a los servicios de emergencia locales. FixList no ofrece ayuda de emergencia.',
  },
  zh: {
    questions: { object: '您想搬什么？', outcome: '您想用它做什么？', location: '您指的是哪个房间？', destination: '要搬到哪里？', quantity: '您指的是多少个？', timing: '需要注明什么时间要求？', access: '需要注明什么进出要求？', correction: '您想修改哪个细节？', review: '您想查看草稿吗？' },
    labels: { object: '物品', outcome: '所需帮助', location: '房间', origin: '起点', destination: '目的地', quantity: '数量', timing: '时间要求', access: '进出要求' },
    unsupported: '我没理解这个细节。', cancelled: '已取消这份草稿。您可以开始新的请求。', context: '对话太长。请开始新的请求并提供要包含的细节。', emergency: '如有紧迫危险或医疗急症，请在可能的情况下转移到安全处并联系当地紧急服务。FixList 无法提供紧急救助。',
  },
  ko: {
    questions: { object: '무엇을 옮기고 싶으세요?', outcome: '어떤 작업을 하고 싶으세요?', location: '어느 방을 말씀하시나요?', destination: '어디로 옮길까요?', quantity: '몇 개를 말씀하시나요?', timing: '어떤 시간 조건을 넣을까요?', access: '출입 안내에 무엇을 넣을까요?', correction: '어떤 내용을 바꾸고 싶으세요?', review: '초안을 확인해 보시겠어요?' },
    labels: { object: '물품', outcome: '요청한 도움', location: '방', origin: '출발 위치', destination: '도착 위치', quantity: '수량', timing: '시간 조건', access: '출입 안내' },
    unsupported: '그 내용을 이해하지 못했어요. ', cancelled: '이 초안을 취소했어요. 새 요청을 시작할 수 있어요.', context: '대화가 너무 길어요. 포함할 내용으로 새 요청을 시작해 주세요.', emergency: '즉각적인 위험이나 응급 상황이라면 가능할 때 안전한 곳으로 이동하고 현지 응급 서비스에 연락하세요. FixList는 응급 도움을 제공할 수 없어요.',
  },
  vi: {
    questions: { object: 'Bạn muốn chuyển đồ gì?', outcome: 'Bạn muốn làm gì với thiết bị đó?', location: 'Bạn muốn nói đến phòng nào?', destination: 'Bạn muốn chuyển đến đâu?', quantity: 'Bạn muốn nói đến bao nhiêu?', timing: 'Bạn muốn ghi yêu cầu thời gian nào?', access: 'Bạn muốn ghi hướng dẫn ra vào nào?', correction: 'Bạn muốn sửa chi tiết nào?', review: 'Bạn muốn xem lại bản nháp không?' },
    labels: { object: 'Đồ vật', outcome: 'Việc cần giúp', location: 'Phòng', origin: 'Từ', destination: 'Đến', quantity: 'Số lượng', timing: 'Thời gian', access: 'Ra vào' },
    unsupported: 'Tôi chưa hiểu chi tiết đó. ', cancelled: 'Đã hủy bản nháp này. Bạn có thể tạo yêu cầu mới.', context: 'Cuộc trò chuyện quá dài. Hãy tạo yêu cầu mới với các chi tiết cần ghi.', emergency: 'Nếu có nguy hiểm tức thời hoặc cấp cứu y tế, hãy đến nơi an toàn nếu có thể và liên hệ dịch vụ khẩn cấp địa phương. FixList không thể hỗ trợ khẩn cấp.',
  },
  tl: {
    questions: { object: 'Ano ang gusto ninyong ilipat?', outcome: 'Ano ang gusto ninyong gawin dito?', location: 'Aling silid ang tinutukoy ninyo?', destination: 'Saan ito ililipat?', quantity: 'Ilan ang tinutukoy ninyo?', timing: 'Anong oras o panahon ang dapat isama?', access: 'Anong tagubilin sa pagpasok ang dapat isama?', correction: 'Aling detalye ang gusto ninyong baguhin?', review: 'Gusto ba ninyong suriin ang draft?' },
    labels: { object: 'Bagay', outcome: 'Hinihinging tulong', location: 'Silid', origin: 'Mula', destination: 'Patutunguhan', quantity: 'Dami', timing: 'Panahon', access: 'Pagpasok' },
    unsupported: 'Hindi ko naunawaan ang detalyeng iyon. ', cancelled: 'Kinansela ang draft na ito. Maaari kayong magsimula ng bagong kahilingan.', context: 'Masyado nang mahaba ang usapan. Magsimula ng bagong kahilingan kasama ang mga kailangang detalye.', emergency: 'Kung may agarang panganib o medikal na emergency, pumunta sa ligtas na lugar kung kaya at tumawag sa lokal na serbisyong pang-emergency. Hindi makapagbibigay ng emergency na tulong ang FixList.',
  },
  ru: {
    questions: { object: 'Что вы хотите передвинуть?', outcome: 'Что вы хотите сделать с устройством?', location: 'Какую комнату вы имеете в виду?', destination: 'Куда это нужно переместить?', quantity: 'Какое количество вы имеете в виду?', timing: 'Какие сроки указать?', access: 'Какие указания для входа добавить?', correction: 'Какую деталь вы хотите изменить?', review: 'Хотите проверить черновик?' },
    labels: { object: 'Предмет', outcome: 'Нужная помощь', location: 'Комната', origin: 'Откуда', destination: 'Куда', quantity: 'Количество', timing: 'Сроки', access: 'Вход' },
    unsupported: 'Я не понял эту деталь. ', cancelled: 'Этот черновик отменён. Можно начать новую заявку.', context: 'Разговор слишком длинный. Начните новую заявку с нужными деталями.', emergency: 'При непосредственной опасности или неотложной медицинской ситуации по возможности перейдите в безопасное место и свяжитесь с местными экстренными службами. FixList не оказывает экстренную помощь.',
  },
  fr: {
    questions: { object: 'Que souhaitez-vous déplacer ?', outcome: 'Que souhaitez-vous faire avec cet appareil ?', location: 'De quelle pièce parlez-vous ?', destination: 'Où faut-il le déplacer ?', quantity: 'Quelle quantité voulez-vous dire ?', timing: 'Quel délai dois-je inclure ?', access: 'Quelles consignes d’accès dois-je inclure ?', correction: 'Quel détail souhaitez-vous modifier ?', review: 'Voulez-vous relire le brouillon ?' },
    labels: { object: 'Objet', outcome: 'Aide demandée', location: 'Pièce', origin: 'Départ', destination: 'Destination', quantity: 'Quantité', timing: 'Délai', access: 'Accès' },
    unsupported: 'Je n’ai pas compris ce détail. ', cancelled: 'Ce brouillon est annulé. Vous pouvez commencer une nouvelle demande.', context: 'La conversation est trop longue. Commencez une nouvelle demande avec les détails à inclure.', emergency: 'En cas de danger immédiat ou d’urgence médicale, mettez-vous en sécurité si possible et contactez les secours locaux. FixList ne peut pas fournir d’aide d’urgence.',
  },
  ar: {
    questions: { object: 'ما الذي تريد نقله؟', outcome: 'ما الذي تريد فعله بهذا الجهاز؟', location: 'أي غرفة تقصد؟', destination: 'إلى أين تريد نقله؟', quantity: 'ما الكمية التي تقصدها؟', timing: 'ما التوقيت الذي تريد إضافته؟', access: 'ما تعليمات الدخول التي تريد إضافتها؟', correction: 'ما التفصيل الذي تريد تغييره؟', review: 'هل تريد مراجعة المسودة؟' },
    labels: { object: 'الغرض', outcome: 'المساعدة المطلوبة', location: 'الغرفة', origin: 'من', destination: 'إلى', quantity: 'الكمية', timing: 'التوقيت', access: 'الدخول' },
    unsupported: 'لم أفهم هذا التفصيل. ', cancelled: 'ألغيت هذه المسودة. يمكنك بدء طلب جديد.', context: 'المحادثة طويلة جدًا. ابدأ طلبًا جديدًا بالتفاصيل التي تريد إضافتها.', emergency: 'إذا كان هناك خطر فوري أو حالة طبية طارئة، انتقل إلى مكان آمن إن استطعت واتصل بخدمات الطوارئ المحلية. لا يستطيع FixList تقديم مساعدة طارئة.',
  },
};
