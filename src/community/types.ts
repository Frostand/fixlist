// Shared contract for the FixList community experience (elder ↔ volunteer matching).
// Domain, native-assistant and UI work all code against these types; change them only deliberately.
import type { Language } from '../domain/roles';

export type { Language };
export type AccountRole = 'elder' | 'volunteer' | 'family';
/** Demo sign-in only: buttons look like real providers but select a sample account on this device. */
export type SignInProvider = 'apple' | 'google' | 'email';

export interface GeoPoint { lat: number; lng: number }

export interface Account {
  id: string;
  role: AccountRole;
  name: string;
  firstName: string;
  /** Token name from the UI palette, used for the initials avatar. */
  avatarTone: 'sage' | 'clay' | 'sky' | 'plum' | 'sun';
  language: Language;
  provider: SignInProvider;
  /** Public, approximate area such as "Cumming, GA". */
  area: string;
  /** Fictional, approximate point (neighborhood level). Never a real home. */
  location: GeoPoint;
  createdAt: string;
}

export interface ElderProfile {
  accountId: string;
  /** Short phrases the elder chose, e.g. "Hard to use ladders". */
  needs: readonly string[];
  /** Fictional street-level hint, revealed to a volunteer only after they accept a job. */
  addressHint: string;
  familyIds: readonly string[];
}

export const SKILLS = ['general', 'lifting', 'electrical-basic', 'plumbing-basic', 'carpentry', 'yard', 'tech-help', 'cleaning', 'errands', 'safety-install', 'companionship'] as const;
export type Skill = typeof SKILLS[number];
export const TOOLS = ['ladder', 'drill', 'screwdriver-set', 'hammer', 'stud-finder', 'level', 'pliers', 'tape-measure', 'gloves', 'car', 'watering-can'] as const;
export type Tool = typeof TOOLS[number];
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
export type DayPart = 'morning' | 'afternoon' | 'evening';
export interface AvailabilitySlot { day: Weekday; part: DayPart }

export interface VolunteerProfile {
  accountId: string;
  skills: readonly Skill[];
  tools: readonly Tool[];
  availability: readonly AvailabilitySlot[];
  maxMiles: number;
  /** Shown on the service-hours log, e.g. "Lambert High School". Optional. */
  school?: string;
  bio: string;
  /** Demo badges; no real verification happens in this build. */
  badges: { idChecked: boolean; backgroundCheck: boolean };
}

export interface FamilyLink { accountId: string; elderIds: readonly string[] }

export const TASK_CATEGORIES = ['repair', 'safety', 'yard', 'household', 'errand', 'tech', 'companionship', 'moving'] as const;
export type TaskCategory = typeof TASK_CATEGORIES[number];
export type Urgency = 'today' | 'this-week' | 'flexible';
export type JobSource = 'voice' | 'typed' | 'scan' | 'quick-pick';
export type AnalysisEngine = 'apple-on-device' | 'rules';

/** What the AI (or the rules fallback) extracted from the elder's words or a scan flag. */
export interface JobAnalysis {
  title: string;          // in the elder's language
  titleEnglish: string;
  summary: string;        // one or two plain sentences, elder's language
  summaryEnglish: string;
  category: TaskCategory;
  skills: readonly Skill[];
  tools: readonly Tool[];
  estimatedMinutes: number;
  peopleNeeded: 1 | 2;
  urgency: Urgency;
  safetyNotes: readonly string[]; // English, short
  language: Language;
  engine: AnalysisEngine;
}

/** A scan flag the elder turned into a request; lets the volunteer "see the spot" before going. */
export interface ScanEvidence {
  roomId: string;
  photoId: string;
  flagId: string;
  label: string;
  point: { u: number; v: number } | null;
  /** Small JPEG data URL so the job card renders without the capture store. */
  thumbnail: string | null;
}

export type JobStatus = 'open' | 'accepted' | 'on-the-way' | 'arrived' | 'reported-done' | 'completed' | 'cancelled';
export type JobEventType = 'posted' | 'accepted' | 'on-the-way' | 'arrived' | 'reported-done' | 'confirmed' | 'rated' | 'cancelled';
export interface JobEvent { at: string; actorId: string; type: JobEventType; note?: string }
export interface Rating { stars: 1 | 2 | 3 | 4 | 5; note?: string; byId: string; at: string }

export interface Job {
  id: string;
  elderId: string;
  createdById: string; // elder or a linked family member
  createdAt: string;
  source: JobSource;
  originalText: string;
  analysis: JobAnalysis;
  evidence: readonly ScanEvidence[];
  preferredSlots: readonly AvailabilitySlot[];
  repeatEveryDays: number | null;
  status: JobStatus;
  volunteerId: string | null;
  scheduledFor: string | null; // ISO
  timeline: readonly JobEvent[];
  rating: Rating | null;
  hoursCredited: number | null; // set when the elder confirms completion
}

export interface ChatMessage {
  id: string;
  jobId: string;
  fromId: string;
  at: string;
  text: string;
  language: Language;
  translations: Partial<Record<Language, string>>;
}

export type MatchReason =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'available'; slot: AvailabilitySlot }
  | { kind: 'distance'; miles: number }
  | { kind: 'rating'; stars: number }
  | { kind: 'language'; language: Language };
export type MatchGap =
  | { kind: 'missing-skill'; skill: Skill }
  | { kind: 'missing-tool'; tool: Tool }
  | { kind: 'no-shared-time' }
  | { kind: 'too-far'; miles: number };

export interface MatchResult {
  jobId: string;
  volunteerId: string;
  score: number; // 0..100, integer
  distanceMiles: number; // one decimal
  reasons: readonly MatchReason[];
  gaps: readonly MatchGap[];
  sharedSlots: readonly AvailabilitySlot[];
}

export interface VolunteerStats { rating: number | null; ratingCount: number; jobsDone: number; hours: number }

export interface CommunityState {
  version: 1;
  session: { accountId: string | null; onboarded: readonly string[] };
  accounts: readonly Account[];
  elders: readonly ElderProfile[];
  volunteers: readonly VolunteerProfile[];
  families: readonly FamilyLink[];
  jobs: readonly Job[];
  messages: readonly ChatMessage[];
}

export type CommunityFailure = { ok: false; code: 'not_found' | 'permission_denied' | 'invalid_state' | 'invalid_input' | 'conflict'; message: string };
export type CommunityResult = { ok: true; state: CommunityState } | CommunityFailure;

// ---- On-device assistant bridge (implemented in src/lib/assistant.ts) ----
export type AssistantModelReason = 'requires-iOS-26' | 'unsupported-language' | 'apple-intelligence-not-enabled' | 'device-not-eligible' | 'model-not-ready' | 'model-unavailable' | 'native-unavailable';
export type AssistantInputReason = 'permission-denied' | 'recognizer-unavailable' | 'on-device-recognition-unavailable';
/** Native flags describe the selected language on this device now, not measured quality.
 * Browser flags describe Web Speech API presence; they do not promise local audio or locale support. */
export interface AssistantAvailability {
  language: Language;
  onDeviceModel: boolean;
  speechInput: boolean;
  speechOutput: boolean;
  reason?: AssistantModelReason;
  speechInputReason?: AssistantInputReason;
  speechOutputReason?: 'voice-unavailable';
}
export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface AssistantReply {
  text: string;            // reply in the user's language, short, warm, plain
  job: JobAnalysis | null; // present when the assistant has enough to draft a request
  engine: AnalysisEngine;
  /** Original user turns in the bounded context window, in order. Never model-produced or assistant text. */
  originalText?: string;
}
export interface ListeningSession {
  readonly sessionId: string;
  readonly done: Promise<{ sessionId: string; reason: 'final' | 'stopped' | 'cancelled' | 'error' | 'interrupted' | 'background'; text: string }>;
  stop(): Promise<string>;
  cancel(): void;
}
export interface Assistant {
  availability(language: Language): Promise<AssistantAvailability>;
  analyzeTask(text: string, language: Language): Promise<JobAnalysis>;
  chat(turns: readonly ChatTurn[], language: Language, context: { firstName: string }): Promise<AssistantReply>;
  startListening(language: Language, onPartial: (text: string) => void, signal?: AbortSignal): Promise<ListeningSession>;
  speak(text: string, language: Language): Promise<void>;
  stopSpeaking(): void;
  translate(text: string, from: Language, to: Language): Promise<string | null>;
}
