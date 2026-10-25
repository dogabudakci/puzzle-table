import { t } from './i18n.js';
// Loading an uploaded photo and judging whether its resolution is good enough for a puzzle.

// Huge camera photos are scaled down to this size; more detail than this isn't visible on screen.
const MAX_WORKING_SIDE = 2400;

export async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error(t('start.fileNotImagePlease'));
  }

  const url = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(t('start.imageCouldNotRead')));
    el.src = url;
  });

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // Working copy used later to cut the pieces.
  const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return { name: file.name.replace(/\.[^.]+$/, '') || 'Photo', url, width, height, canvas }; // no file ending
}

// Rates the photo by its shorter side, since that limits how many pieces fit across it.
export function analyzeResolution(width, height) {
  const shortSide = Math.min(width, height);

  if (shortSide < 300) {
    return {
      level: 'reject',
      label: t('start.tooSmall'),
      message: t('start.photoTooSmallMake'),
    };
  }
  if (shortSide < 800) {
    return {
      level: 'low',
      label: t('start.lowResolution'),
      message: t('start.willWorkButPieces'),
    };
  }
  if (shortSide < 1500) {
    return {
      level: 'good',
      label: t('start.good'),
      message: t('start.goodResolutionPiecesWill'),
    };
  }
  return {
    level: 'excellent',
    label: t('start.excellent'),
    message: t('start.excellentResolutionMakePuzzle'),
  };
}
