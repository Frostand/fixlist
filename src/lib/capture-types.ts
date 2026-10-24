import type { Language } from '../domain/roles';
/** Shared types for room capture v1. Binding format: docs/capture-v1-contract.md. Validation lives in capture-model.ts. */
export type Vec2 = readonly [number, number];
export type Matrix4 = readonly number[]; // 16 numbers, column-major camera-to-world
export type CaptureMode = 'arkit' | 'photos';

export interface CaptureCamera {
  transform: Matrix4;
  /** [fx, fy, cx, cy] in pixels of the stored upright JPEG. */
  intrinsics: readonly [number, number, number, number];
  tracking: 'normal' | 'limited';
}

export interface CapturePhoto {
  photoId: string;
  checklistItemId: string | null;
  takenAt: string;
  width: number;
  height: number;
  sha256: string;
  camera: CaptureCamera | null;
}

export interface CaptureOutline { closed: boolean; points: readonly Vec2[] }

export interface CaptureManifest {
  format: 'fixlist-room-capture';
  version: 1;
  captureId: string;
  roomId: string;
  createdAt: string;
  mode: CaptureMode;
  floorY: number | null;
  outline: CaptureOutline | null;
  doors: readonly Vec2[];
  photos: readonly CapturePhoto[];
}

/** Local playback sidecar; never part of the v1 photo manifest or export. */
export const MAX_CAPTURE_VIDEO_BYTES = 12_582_912;
export interface CaptureVideo {
  videoId: 'v01'; takenAt: string; mimeType: 'video/mp4'; codec: 'avc1';
  width: number; height: number; durationMs: number; byteLength: number; sha256: string;
}
export interface CaptureVideos {
  format: 'fixlist-capture-videos'; version: 1; captureId: string; roomId: string;
  clips: readonly [CaptureVideo];
}
export interface CaptureVideoAssets { videos: CaptureVideos | null; videoBlobs: ReadonlyMap<string, Blob> }

export interface PixelPoint { u: number; v: number }

export interface CaptureSuggestionRow { photoId: string; rawProbability: number; probability: number; relevanceProbability: number }

export interface CaptureSuggestionItem {
  checklistItemId: string;
  concernId: string;
  question: string;
  relevanceQuestion: string;
  limitation: string;
  status: 'suggested' | 'below-threshold' | 'not-visible';
  score: number | null;
  bestPhotoId: string | null;
  perPhoto: readonly CaptureSuggestionRow[];
  point: PixelPoint | null;
}

export interface CaptureSuggestionsFile {
  format: 'fixlist-capture-suggestions';
  version: 1;
  createdAt: string;
  capture: { captureId: string; roomId: string; photos: readonly { photoId: string; sha256: string }[] };
  model: { name: string; backend: 'mlx' | 'coreml'; engine: 'startlux-decision' | 'clip-zero-shot'; license: string; identity: null | { version: 1; weightsSHA256: string; runtimeSHA256: string } };
  /** Per-item relevance thresholds are required only for the pinned Core ML backend. */
  thresholds: { suggestion: number; relevance: number; location: number; perItem?: Readonly<Record<string, number>> };
  calibration: null | Record<string, unknown>;
  notice: string;
  items: readonly CaptureSuggestionItem[];
}

/** Checklist items never shown as capture flags (zero calibration positives). */
export const CAPTURE_FLAG_EXCLUDED: ReadonlySet<string> = new Set(['handrail-check', 'stair-lighting-check']);

/** A flag as drawn by RoomSketch; placement is computed from the manifest. */
export interface SketchFlag { id: string; checklistItemId: string; photoId: string; point: PixelPoint | null; label: string }

export interface RoomSketchProps {
  capture: CaptureManifest;
  /** Object URLs for stored photo Blobs, keyed by photoId. */
  photoUrls: ReadonlyMap<string, string>;
  flags: readonly SketchFlag[];
  selectedId: string | null;
  onSelect(id: string): void;
  mode: 'plan' | '3d';
}

/** Native plugin surface (ios/App/App/FixListCapturePlugin.swift). */
export type CameraPermission = 'authorized' | 'denied' | 'restricted' | 'not-determined';
export interface NativeCaptureStartOptions {
  captureId: string;
  roomId: string;
  roomName: string;
  language: Language;
  prompts: readonly { checklistItemId: string | null; text: string }[];
  strings: Readonly<Record<string, string>>;
}
export type NativeCaptureResult = Omit<CaptureManifest, 'photos'> & { photos: readonly CapturePhoto[]; files: Readonly<Record<string, string>>; videos?: CaptureVideos };
export interface NativeCaptureOutcome { status: 'completed' | 'cancelled' | 'unavailable' | 'denied' | 'failed'; reason?: string; capture?: NativeCaptureResult; cleanupFailed?: boolean }
export interface FixListCapturePlugin {
  availability(): Promise<{ arkit: boolean; camera: CameraPermission }>;
  start(options: NativeCaptureStartOptions): Promise<NativeCaptureOutcome>;
  discard(options: { captureId: string }): Promise<void>;
  discardAll(): Promise<void>;
  shareFile(options: { fileName: string; text: string }): Promise<{ completed: boolean }>;
}

/**
 * Every on-screen string the native capture screen shows; the web app supplies them per language.
 * Placeholders: {current}, {total}, {count}, {seconds}.
 */
export const NATIVE_CAPTURE_STRING_KEYS = [
  'stepOutline', 'stepPhotos', 'aimCorner', 'moreCorners', 'closeAtFirst', 'addCorner',
  'moreOptions', 'usePhoto', 'doorChip', 'approximateShort', 'previewNextState',
  'findFloor', 'floorFound', 'trackingLimited', 'interrupted', 'relocalizeFailed',
  'restartTracking', 'restartConfirmTitle', 'restartConfirmMessage',
  'tapCorners', 'cornerCount', 'undo', 'closeOutline', 'markDoor', 'doorMode', 'skipOutline', 'approximate',
  'photoProgress', 'shutter', 'retake', 'skip', 'next', 'done',
  'cancel', 'cancelConfirmTitle', 'cancelConfirmMessage', 'cancelConfirmStop', 'cancelConfirmKeep',
  'recordVideo', 'stopVideo', 'useVideo', 'retakeVideo', 'videoRecording', 'videoReview',
  'videoSaved', 'videoFailed', 'videoStopped', 'videoNeedsPhoto', 'videoLimit', 'videoCancel',
] as const;
export type NativeCaptureStringKey = typeof NATIVE_CAPTURE_STRING_KEYS[number];
