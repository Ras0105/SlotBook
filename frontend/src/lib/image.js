// Shrinks a chosen picture in the browser before it is uploaded: a square, 400 x 400 JPEG is a few
// dozen KB (the server accepts up to 512 KB), so uploads are quick and the pages stay light.

export const MAX_INPUT_BYTES = 10 * 1024 * 1024; // refuse to even open anything bigger than this
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SIZE = 400;

/** Returns an error sentence if the file cannot be used, otherwise null. */
export function checkImageFile(file) {
  if (!file) return 'Choose a picture first.';
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP picture.';
  if (file.size > MAX_INPUT_BYTES) return 'That picture is too large. Choose one under 10 MB.';
  return null;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as a picture.'));
    };
    img.src = url;
  });
}

/** Centre-crop to a square and scale to SIZE x SIZE. Resolves with a JPEG Blob. */
export async function squareThumbnail(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent logos get a white background instead of turning black in a JPEG
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('That picture could not be prepared.'))),
      'image/jpeg',
      0.86,
    );
  });
}
