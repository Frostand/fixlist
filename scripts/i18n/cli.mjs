import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { languageCodes, assertLanguage, status, exportPending, importTranslations } from './lib.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const [command, language, file, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !['status', 'export', 'import'].includes(command)) throw new Error('Usage: i18n:status [language] | i18n:export <language> | i18n:import <language> <file.json>');
  if (language) assertLanguage(language);
  if (command === 'status') {
    if (file) throw new Error('Status takes an optional language only.');
    for (const code of language ? [language] : languageCodes) {
      const report = status(root, code);
      process.stdout.write(`${code}: ${report.translated}/${report.total} translated; missing=${report.missing.length}; stale=${report.stale.length}; obsolete=${report.obsolete.length}\n`);
      for (const kind of ['missing', 'stale', 'obsolete']) if (report[kind].length) process.stdout.write(`  ${kind}: ${report[kind].join(', ')}\n`);
    }
  } else if (command === 'export') {
    if (!language || file) throw new Error('Export takes exactly one language.');
    process.stdout.write(JSON.stringify(exportPending(root, language), null, 2) + '\n');
  } else {
    if (!language || !file) throw new Error('Import requires a language and a JSON file. Export that language first.');
    const count = importTranslations(root, language, JSON.parse(readFileSync(file, 'utf8')));
    process.stdout.write(`${language}: imported ${count} translated keys.\n`);
  }
} catch (error) {
  process.stderr.write(`i18n: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
