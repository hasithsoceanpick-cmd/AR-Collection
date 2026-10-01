// Shrink a phone photo before upload: longest side 1600px, JPEG quality 0.7.
// A 4 MB camera photo becomes roughly 150–250 KB and stays readable.
export async function compressImage(file, maxSide = 1600, quality = 0.7) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file is not an image the browser can read'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width, h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo'))), 'image/jpeg', quality),
  );
}
