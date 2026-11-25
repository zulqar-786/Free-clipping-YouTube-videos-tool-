export type ExtractionStyle =
  | 'corporate'
  | 'executive'
  | 'educational'
  | 'podcast';

export type OutputLanguage = 'english' | 'hinglish' | 'hindi';

export interface CaptionSegment {
  offsetSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface ShortClip {
  id: string;
  clipNumber: number;
  title: string;
  hookText: string;
  corporateAngle: string;
  startSeconds: number;
  endSeconds: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  whyItWorks: string;
  captionSegments: CaptionSegment[];
  socialCaption: string;
  bRollSuggestion: string;
}

export interface SourceVideoMeta {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  analysisMethod: 'transcript' | 'video-stream' | 'manual-transcript';
}

export interface ExtractionResult {
  video: SourceVideoMeta;
  style: ExtractionStyle;
  language: OutputLanguage;
  targetDuration: number;
  clips: ShortClip[];
  extractedAt: string;
}

export interface ExtractRequestPayload {
  url: string;
  clipCount: number;
  targetDuration: number;
  style: ExtractionStyle;
  language: OutputLanguage;
  manualTranscript?: string;
}
