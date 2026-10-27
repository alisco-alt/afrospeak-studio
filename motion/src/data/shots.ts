import type { CamPreset } from '../library/Camera';
import type { KenBurnsDirection } from '../library/KenBurns';
import type { FigureSpec } from '../library/Charts';
// Contrat extensible des scénarios JSON embarqués et des captures spécialisées.
export interface ScreenSpec { kind: string; [key: string]: any }
export interface BaseBeat {
  at: number; kind: string; vo: string; name?: string; cam?: CamPreset;
  caption?: string; highlight?: string; figure?: FigureSpec | false;
  [key: string]: any;
}
export interface CinematicBeat extends BaseBeat { image?: string; kb?: KenBurnsDirection }
export interface ExplainerBeat extends BaseBeat { screens?: ScreenSpec[] }
export interface ShotScript {
  id: string; title: string; template: 'explainer' | 'cinematic'; fps: number;
  durationInFrames: number; beats: BaseBeat[]; music?: string;
  brand?: { logo?: string; mark?: string; showLogo?: boolean; watermark?: boolean };
  sources: { label: string; value: string }[];
}
