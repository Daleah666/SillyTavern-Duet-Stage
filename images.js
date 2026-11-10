/**
 * Image import keeps the bytes it was given. Nothing here draws to a
 * canvas, resamples, crops, or changes the aspect ratio.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export function isImageName(name) {
    return IMAGE_EXT.test(String(name || ''));
}

export function labelFromName(name) {
    const base = String(name || '').split(/[\\/]/).pop() || 'sprite';
    const stem = base.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    return stem || 'sprite';
}

export function fileNameOf(path, label) {
    const base = String(path || '').split('?')[0].split(/[\\/]/).pop() || '';
    if (base && base.includes('.')) return base;
    const safe = String(label || 'sprite').replace(/[\\/]/g, '-').trim() || 'sprite';
    return `${safe}.png`;
}

export function displayName(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    if (raw !== raw.toLowerCase()) return raw;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Return the same file when the name already matches. A Blob becomes a
 * File with that name. The bytes are copied as-is.
 */
export function originalImage(file, name) {
    if (!file) return null;
    const filename = name || file.name || 'sprite.png';
    if (typeof File !== 'undefined' && file instanceof File && file.name === filename) return file;
    const type = file.type || 'application/octet-stream';
    if (typeof File === 'undefined') return file;
    return new File([file], filename, { type, lastModified: file.lastModified || Date.now() });
}
