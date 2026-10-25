import React from 'react';
import { Composition } from 'remotion';
import { ShotPhp2Shell } from './shots/ShotPhp2Shell';
import { ShotAfroSpeak } from './shots/ShotAfroSpeak';
import { SHOTS } from './data/shots';

/**
 * 1 plan JSON = 2 compositions (16:9 + 9:16).
 * Le pont lib/motion.js du studio rend exactement ces identifiants :
 *   `${shot.id}-16x9` / `${shot.id}-9x16`
 */
const COMPONENTS: Record<string, React.FC> = {
  'php2shell-hook': ShotPhp2Shell,
  'afrospeak-voice': ShotAfroSpeak,
};

export const FORMATS = [
  { suffix: '16x9', width: 1920, height: 1080 },
  { suffix: '9x16', width: 1080, height: 1920 },
] as const;

export const RemotionRoot: React.FC = () => (
  <>
    {SHOTS.map((shot) =>
      FORMATS.map((f) => {
        const Comp = COMPONENTS[shot.id];
        if (!Comp) return null;
        return (
          <Composition
            key={`${shot.id}-${f.suffix}`}
            id={`${shot.id}-${f.suffix}`}
            component={Comp}
            width={f.width}
            height={f.height}
            fps={shot.fps}
            durationInFrames={shot.durationInFrames}
          />
        );
      }),
    )}
  </>
);
