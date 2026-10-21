import { render } from '@gpuix/solid';
import { App } from './ui/App';

render(() => <App />, {
  title: 'Nixstore', appName: 'Nixstore', width: 1120, height: 760,
  titlebarTransparent: true, windowBackground: 'blurred',
  trafficLightX: 18, trafficLightY: 22,
  focus: process.env.GPUIX_BACKGROUND !== '1',
});
