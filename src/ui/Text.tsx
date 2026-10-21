import { children, splitProps, type JSX } from 'solid-js';
import type { HostProps } from '@gpuix/solid';

/** GPUI paints text children as block runs. Join mixed JSX fragments into one run. */
export function Text(all: HostProps & { children?: JSX.Element }) {
  const [own, host] = splitProps(all, ['children']);
  const content = children(() => own.children);
  return <text {...host}>{[content()].flat(Infinity).filter(value => value != null && value !== false).join('')}</text>;
}
