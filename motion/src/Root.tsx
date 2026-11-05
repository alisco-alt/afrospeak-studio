import React from 'react';
import { Composition } from 'remotion';
import { Explainer } from './templates/Explainer';
import { Cinematic } from './templates/Cinematic';
import { Thumbnail } from './thumbnail/Thumbnail';
import { FORMATS as THUMBNAIL_FORMATS } from './thumbnail/layout.js';
import type { ShotScript } from './data/shots';
import type { StylePack } from './ds/themes';
import {
  HeadlineHighlighter,
  HeadlineHighlighterProps,
  DataPulse,
  DataPulseProps,
  RouteMap,
  RouteMapProps,
  PaperCutoutPortrait,
  PaperCutoutProps,
} from './templates/MotionInserts';
import php2shell from '../shots/php2shell-hook.json';
import afrospeak from '../shots/afrospeak-voice.json';
import doc from '../shots/php2shell-doc.json';
import demo from '../shots/infographies-demo.json';
import detteM6 from '../shots/dette-africaine-m6.json';

const SHOTS: ShotScript[] = [
  php2shell as unknown as ShotScript,
  afrospeak as unknown as ShotScript,
  doc as unknown as ShotScript,
  demo as unknown as ShotScript,
  detteM6 as unknown as ShotScript,
];

const FORMATS = [
  { suffix: '16x9', width: 1920, height: 1080 },
  { suffix: '9x16', width: 1080, height: 1920 },
];

const ShotComp: React.FC<{ shot: ShotScript; stylePack?: StylePack | null }> = ({ shot, stylePack }) =>
  shot.template === 'cinematic' ? <Cinematic shot={shot} stylePack={stylePack ?? null} /> : <Explainer shot={shot} stylePack={stylePack ?? null} />;

export const RemotionRoot: React.FC = () => (
  <>
    {/* 4 TEMPLATES PRO MONEY RADAR */}
    <Composition
      id="HeadlineHighlighter"
      component={HeadlineHighlighter}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        newspaper: 'FINANCIAL TIMES',
        date: 'ACTUALITÉ ÉCONOMIQUE',
        headline: 'MINERAIS STRATÉGIQUES : DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ',
        highlightText: 'DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ',
        category: 'EXCLUSIF',
      }}
    />

    <Composition
      id="DataPulse"
      component={DataPulse}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        value: 30,
        suffix: '%',
        label: 'DES MINERAIS DE LA PLANÈTE',
        sublabel: 'Ressources mondiales concentrées en Afrique',
        color: '#FFD700',
      }}
    />

    <Composition
      id="RouteMap"
      component={RouteMap}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        origin: 'AFRIQUE (RDC / GUINÉE)',
        destination: 'CENTRES INDUSTRIELS MONDIAUX',
        resource: 'COBALT & BAUXITE BRUTS',
        subtext: 'Flux de matières premières sans transformation locale',
      }}
    />

    <Composition
      id="PaperCutoutPortrait"
      component={PaperCutoutPortrait}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        name: 'GÉANTS INDUSTRIELS',
        role: 'NÉGOCE ET EXTRACTION MONDIALE',
        quote: 'La valeur part, les emplois restent ailleurs',
      }}
    />

    {/* THUMBNAILS */}
    {Object.entries(THUMBNAIL_FORMATS).map(([format, spec]) => (
      <Composition
        key={spec.id}
        id={spec.id}
        component={Thumbnail}
        durationInFrames={1}
        fps={30}
        width={spec.width}
        height={spec.height}
        defaultProps={{ image: '', title: 'Le cacao ivoirien', format: format as '16x9' | '9x16' }}
      />
    ))}

    {/* EXPLAINER / CINEMATIC SHOTS */}
    {SHOTS.map((shot) =>
      FORMATS.map((fmt) => (
        <Composition
          key={`${shot.id}-${fmt.suffix}`}
          id={`${shot.id}-${fmt.suffix}`}
          component={ShotComp}
          durationInFrames={shot.durationInFrames}
          fps={shot.fps}
          width={fmt.width}
          height={fmt.height}
          defaultProps={{ shot, stylePack: null }}
        />
      )),
    )}
  </>
);
