/** Reads a File as a base64 string (no data: prefix). */
export async function fileToBase64(file) {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
		reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
		reader.readAsDataURL(file);
	});
}

/** Best-effort mime type, falling back to extension sniffing. Normalises to always return a valid image or pdf type. */
export function getMimeType(file) {
	const raw = (file.type || '').toLowerCase();
	if (raw === 'image/jpg') return 'image/jpeg';
	if (raw.startsWith('image/')) return raw;
	if (/\.pdf$/i.test(file.name)) return 'application/pdf';
	if (/\.png$/i.test(file.name)) return 'image/png';
	if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
	if (/\.gif$/i.test(file.name)) return 'image/gif';
	if (/\.webp$/i.test(file.name)) return 'image/webp';
	if (/\.tiff?$/i.test(file.name)) return 'image/tiff';
	return 'application/octet-stream';
}

export function isImageFile(file) {
	const name = (file.name || '').toLowerCase();
	const type = (file.type || '').toLowerCase();
	return type.startsWith('image/') || /\.(png|jpe?g|tiff|gif|webp)$/i.test(name);
}

/**
 * Compresses an image file to a max dimension and JPEG quality to reduce
 * base64 payload size for API calls. Returns the original file unchanged
 * for PDFs or non-image files.
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.75 } = {}) {
	if (!isImageFile(file)) return file;

	return new Promise((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			let { naturalWidth: w, naturalHeight: h } = img;
			if (w > maxDim || h > maxDim) {
				const scale = maxDim / Math.max(w, h);
				w = Math.round(w * scale);
				h = Math.round(h * scale);
			}
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0, w, h);
			canvas.toBlob(
				(blob) => {
					if (blob) {
						resolve(new File([blob], file.name, { type: 'image/jpeg' }));
					} else {
						resolve(file);
					}
				},
				'image/jpeg',
				quality,
			);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(file);
		};
		img.src = url;
	});
}

/** Converts a File into an `inline_data` part for the API. */
export async function fileToInlineDataPart(file) {
	const data = await fileToBase64(file);
	const mime = getMimeType(file);
	return { inline_data: { mime_type: mime, data } };
}
