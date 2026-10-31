// Spillere valgt til sammenligning i assistenten (kun UI-tilstand)
import { notify } from '../game/state';

export const compareIds: number[] = [];

export function toggleCompare(id: number) {
  const i = compareIds.indexOf(id);
  if (i >= 0) compareIds.splice(i, 1);
  else {
    compareIds.push(id);
    if (compareIds.length > 3) compareIds.shift();
  }
  notify();
}
