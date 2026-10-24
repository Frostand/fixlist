import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../domain/roles';
import { analyzeTaskWithRules, QUICK_PICK_IDS, quickPickAnalysis, scanFlagAnalysis } from './task-rules';
import { analysis as validAnalysis } from './validation';
import type { Language } from './types';

describe('multilingual rules fallback', () => {
  it.each([
    ['en', "the kitchen light bulb burned out and I can't reach it"], ['es', 'La bombilla de la cocina no funciona.'],
    ['ko', '부엌 전구가 나갔어요'], ['zh', '厨房的灯泡坏了，我够不到。'], ['vi', 'Bóng đèn nhà bếp bị cháy, tôi không với tới.'],
    ['tl', 'Palitan ang bumbilya sa kusina'], ['ru', 'Нужно заменить лампочку'], ['fr', 'Une ampoule ne fonctionne plus'], ['ar', 'أحتاج إلى تغيير مصباح الإضاءة'],
  ] satisfies [Language, string][])('recognizes a bulb request in %s with a localized draft', (language, input) => {
    const result = analyzeTaskWithRules(input, language);
    expect(result.engine).toBe('rules'); expect(result.language).toBe(language);
    expect(result.category).toBe('repair'); expect(result.skills).toContain('electrical-basic'); expect(result.tools).toContain('ladder');
    expect(result.titleEnglish).toBe('Replace a light bulb'); expect(validAnalysis(result)).toBe(true);
    if (language !== 'en') { expect(result.title).not.toBe(result.titleEnglish); expect(result.summary).not.toBe(result.summaryEnglish); }
  });
  it.each([
    ['es', 'Quisiera instalar una barra de apoyo', 'safety'], ['ko', '휴대폰 사용을 도와주세요', 'tech'],
    ['zh', '请帮我买菜', 'errand'], ['vi', 'Giúp tôi tưới cây', 'household'], ['en', 'Help move the sofa', 'moving'],
  ] satisfies [Language, string, string][])('classifies %s: %s', (language, input, category) => {
    expect(analyzeTaskWithRules(input, language).category).toBe(category);
  });
  it('keeps uncertainty for an unknown task and recognizes urgency without confirming anything', () => {
    expect(analyzeTaskWithRules('Could you help me?', 'en')).toMatchObject({ category: 'household', skills: ['general'], engine: 'rules' });
    expect(analyzeTaskWithRules('Necesito la compra hoy', 'es').urgency).toBe('today');
    expect(analyzeTaskWithRules('전구를 오늘 교체해 주세요', 'ko').urgency).toBe('today');
    expect(analyzeTaskWithRules('Water the plants, no rush', 'en').urgency).toBe('flexible');
  });
  it.each(LANGUAGE_CODES)('has all eight localized quick picks for %s', (language) => {
    expect(QUICK_PICK_IDS).toHaveLength(8);
    for (const id of QUICK_PICK_IDS) {
      const result = quickPickAnalysis(id, language);
      expect(validAnalysis(result)).toBe(true); expect(result.language).toBe(language);
      if (language !== 'en') expect(result.title).not.toBe(result.titleEnglish);
    }
  });
  it.each([
    ['rug-check', 'Secure or remove a loose rug', []], ['night-lighting-check', 'Install night lights', []],
    ['grab-bar-check', 'Install a grab bar', ['drill', 'stud-finder']], ['clutter', 'Clear a walkway', ['gloves']],
    ['smoke-alarm-check', 'Check a smoke alarm', ['ladder']], ['something-unknown', 'Help with a household task', []],
  ])('turns %s into a reviewable draft', (id, title, tools) => {
    const result = scanFlagAnalysis(id as string, 'Unverified area to review', 'en');
    expect(result.titleEnglish).toBe(title); expect(result.tools).toEqual(expect.arrayContaining(tools));
    expect(result.safetyNotes.join(' ')).toContain('unverified room flag'); expect(result.engine).toBe('rules');
  });
  it('recognizes a light that is out without the word "bulb"', () => {
    for (const [text, language] of [["The light in my hallway is out and I can't reach it.", 'en'], ['the lamp in my bedroom stopped working', 'en'], ['La luz del pasillo no funciona', 'es'], ['부엌 불이 나갔어요', 'ko']] as const) {
      const result = analyzeTaskWithRules(text, language);
      expect(result.titleEnglish).toBe('Replace a light bulb');
      expect(result.tools).toContain('ladder');
    }
  });
  it.each([
    'Help me carry this light chair outside.', 'Put the light boxes outside for collection.',
    'Help me carry this light chair outdoors.', 'Put the light boxes outdoors for collection.',
  ])('does not treat outside/outdoors as a light that is out: %s', (text) => {
    const result = analyzeTaskWithRules(text, 'en');
    expect(result.titleEnglish).not.toBe('Replace a light bulb');
    expect(result.tools).not.toContain('ladder');
  });

  it('returns fresh arrays so caller edits cannot change later drafts', () => {
    const first = quickPickAnalysis('light-bulb', 'en'); (first.tools as string[]).push('car');
    expect(quickPickAnalysis('light-bulb', 'en').tools).toEqual(['ladder']);
  });
});

describe('bounded urgency regression corpus (templates, not translation quality)', () => {
  it.each([
    ['en', 'Water plants, not urgent'], ['es', 'Regar plantas, no es urgente'],
    ['ko', '화분 물 주기, 급하지 않아요'], ['zh', '浇水，不紧急'],
    ['vi', 'Tưới cây, không khẩn cấp'], ['tl', 'Diligan ang halaman, hindi agaran'],
    ['ru', 'Полить растения, не срочно'], ['fr', 'Arroser les plantes sans urgence'],
    ['ar', 'سقي النباتات، غير عاجل'],
  ] satisfies [Language, string][])('does not promote negated urgency in %s', (language, text) => {
    expect(analyzeTaskWithRules(text, language).urgency).toBe('flexible');
  });
  it.each([
    ['en', 'Not urgent, but please water plants today'], ['es', 'No es urgente, pero regar plantas hoy'],
    ['ko', '급하지 않지만 오늘 화분에 물 주세요'], ['zh', '不紧急，但今天浇水'],
    ['vi', 'Không khẩn cấp, nhưng tưới cây hôm nay'], ['tl', 'Hindi agaran, pero diligan ang halaman ngayon'],
    ['ru', 'Не срочно, но полить растения сегодня'], ['fr', 'Sans urgence, mais arroser aujourd’hui'],
    ['ar', 'غير عاجل، لكن سقي النباتات اليوم'],
  ] satisfies [Language, string][])('preserves independent explicit today intent in %s', (language, text) => {
    expect(analyzeTaskWithRules(text, language).urgency).toBe('today');
  });
  it.each([
    ['en', 'Water plants, not today'], ['es', 'Regar plantas, no hoy'],
    ['ko', '화분에 물 주기, 오늘 말고'], ['zh', '浇水，不是今天'],
    ['vi', 'Tưới cây, không phải hôm nay'], ['tl', 'Diligan ang halaman, hindi ngayon'],
    ['ru', 'Полить растения, не сегодня'], ['fr', 'Arroser, pas aujourd’hui'],
    ['ar', 'سقي النباتات، ليس اليوم'], ['vi', 'Tưới cây, ngày mai'],
    ['vi', 'Tưới cây ở đâyngayđó'], ['en', 'Water plants for the insurgent character in a story'],
    ['es', 'Regar plantas y la hoya'],
  ] satisfies [Language, string][])('does not infer today from negated dates or substrings: %s %s', (language, text) => {
    expect(analyzeTaskWithRules(text, language).urgency).not.toBe('today');
  });
});
