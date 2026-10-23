import type { Language } from '../domain/roles';
import { translate } from './index';
const keys = ["title","approximate","assumptions","noOutline","invalidOutline","openOutline","needsClosed","photo","photos","photoMissing","flag","flags","photoOnly","spot","unverified","plan","legendPhoto","legendFlag","legendDoor","limited","loading","unavailable","three","controls","help","left","right","up","down","in","out","reset"] as const;
type Copy = Record<(typeof keys)[number], string>;
/** Every sketch label uses the same per-key English fallback as the rest of the app. */
export function roomSketchCopy(language: Language): Copy { return Object.fromEntries(keys.map((key) => [key, translate(language, `sketch.${key}`)])) as Copy; }
