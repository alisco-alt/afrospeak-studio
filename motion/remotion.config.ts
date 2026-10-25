import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// 2 vCPU dans la sandbox : on reste à 2 threads de rendu
Config.setConcurrency(1);
// Zéro service payant : rendu 100 % local (Chrome Headless Shell + ffmpeg embarqués par Remotion)
