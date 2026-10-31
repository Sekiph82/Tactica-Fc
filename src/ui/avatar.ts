// Managerens profilbillede: gemmes i browseren pr. karriere (et nyt spil starter uden billede, men kan hente det
// fra den forrige karriere) og vises på den offentlige profil.
import { gs, hasGame } from '../game/state';

const KEY = 'cm0102.avatar';
const careerKey = () => (hasGame() ? `${KEY}:${gs().id}` : KEY);

export function getAvatar(): string {
  try { return localStorage.getItem(careerKey()) ?? ''; } catch { return ''; }
}

export function setAvatar(dataUrl: string) {
  try {
    if (dataUrl) { localStorage.setItem(careerKey(), dataUrl); localStorage.setItem(KEY, dataUrl); } else localStorage.removeItem(careerKey());
  } catch { /* fuld eller blokeret */ }
}

/** Billedet fra den senest brugte karriere (hvis denne karriere ikke har sit eget) */
export function lastAvatar(): string {
  try { return getAvatar() ? '' : localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

/** Skær billedet til et kvadrat og skaler det ned til 192×192 (JPEG, ca. 10–25 kB) */
export function resizeImage(file: File, size = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
