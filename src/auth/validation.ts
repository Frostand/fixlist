import { isLanguage } from '../domain/roles';
import { SKILLS, TOOLS } from '../community/types';
import type { AccountProfile } from './types';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0);
const list = (v: unknown, allowed: readonly string[], max: number) => Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && allowed.includes(x));
/** Treat rows as untrusted even after RLS. Unknown server authority fields never enter AccountProfile. */
export function parseProfile(row: unknown, uid: string): AccountProfile {
    if (!object(row) || row.user_id !== uid || !['elder', 'volunteer'].includes(String(row.role)) || !text(row.name, 80) || !text(row.area, 100)
        || !isLanguage(row.language) || !Array.isArray(row.needs) || row.needs.length > 16 || !row.needs.every(n => text(n, 160))
        || !list(row.skills, SKILLS, SKILLS.length) || !list(row.tools, TOOLS, TOOLS.length) || !Array.isArray(row.availability) || row.availability.length > 21
        || !row.availability.every(s => object(s) && Object.keys(s).length === 2 && Number.isInteger(s.day) && Number(s.day) >= 0 && Number(s.day) <= 6 && ['morning', 'afternoon', 'evening'].includes(String(s.part)))
        || !Number.isInteger(row.max_miles) || Number(row.max_miles) < 1 || Number(row.max_miles) > 50 || !text(row.school, 120, true) || !text(row.updated_at, 60)) throw new Error('Invalid account profile');
    return { userId: uid, role: row.role as AccountProfile['role'], name: row.name, area: row.area, language: row.language, needs: row.needs,
        skills: row.skills as AccountProfile['skills'], tools: row.tools as AccountProfile['tools'], availability: row.availability as AccountProfile['availability'], maxMiles: Number(row.max_miles), school: row.school, updatedAt: row.updated_at };
}
