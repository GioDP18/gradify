// Large enough to view in full on the profile page; small photos elsewhere are scaled down by the browser.
export const AVATAR_SIZE = 640;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // phone photos; the upload itself is ~30–90 KB

/**
 * Turns a chosen photo into a square avatar: centre-cropped, scaled to 640×640, and
 * re-encoded as WebP (JPEG where WebP encoding is unavailable). Re-encoding also drops the
 * photo's metadata (camera details, GPS location).
 */
export async function toSquareAvatar(file, size = AVATAR_SIZE) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is larger than 15 MB. Choose a smaller one.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file); // applies the photo's EXIF rotation
  } catch {
    throw new Error('That image could not be read. Try a different file.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  size = Math.min(size, side); // never enlarge a small image (that adds bytes, not detail)
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();

  const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode('image/webp', 0.86);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg', 0.88);
  if (!jpeg) throw new Error('That image could not be processed. Try a different file.');
  return jpeg;
}
