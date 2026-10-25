import React from 'react';
import { Composition } from 'remotion';
import { Explainer } from './templates/Explainer';
import { Cinematic } from './templates/Cinematic';
import type { ShotScript } from './data/shots';
import php2shell from '../shots/php2shell-hook.json';
import afrospeak from '../shots/afrospeak-voice.json';

/**
 * RACINE REMOTION — une composition par plan × format, nommée
 * `<shotId>-<fmt>` : c'est le contrat d'appel du studio
 * (lib/motion.js → rendreComposition(`${shotId}-${fmt}`)).
 * Le template (Explainer référence A / Cinematic référence B) est
 * choisi par `shot.template`, pas par le format.
 */

const SHOTS: ShotScript[] = [
  php2shell as unknown as ShotScript,
  afrospeak as unknown as ShotScript,
];

const FORMATS = [
  { suffix: '16x9', width: 1920, height: 1080 },
  { suffix: '9x16', width: 1080, height: 1920 },
];

const ShotComp: React.FC<{ shot: ShotScript }> = ({ shot }) =>
  shot.template === 'cinematic' ? <Cinematic shot={shot} /> : <Explainer shot={shot} />;

export const RemotionRoot: React.FC = () => (
  <>
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
          defaultProps={{ shot }}
        />
      )),
    )}
  </>
);
