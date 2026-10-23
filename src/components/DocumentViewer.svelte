<script>
	import { store, getSelectedDocument, clearHighlightField } from '../lib/store.svelte.js';
	import { isImageFile } from '../lib/gemini/fileUtils.js';

	const selectedDoc = $derived(getSelectedDocument());
	const hl = $derived(store.highlightField);

	let docImgEl = $state(null);
	let displayW = $state(0);
	let displayH = $state(0);
	let frameW = $state(0);
	let frameH = $state(0);

	const isImage = $derived(selectedDoc && isImageFile(selectedDoc.file));
	const isPdf = $derived(selectedDoc && !isImageFile(selectedDoc.file));
	const hasBb = $derived(hl && hl.boundingBox);

	let pdfRenderUrl = $state(null);
	let pdfNatW = $state(0);
	let pdfNatH = $state(0);
	let renderGen = 0;

	async function renderPdfToImage(url, pageNumber = 1, gen) {
		console.log(`[DocViewer] renderPdfToImage called: page=${pageNumber}, gen=${gen}, currentRenderGen=${renderGen}`);
		try {
			const pdfjsLib = await import('pdfjs-dist');
			pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
				'pdfjs-dist/build/pdf.worker.min.mjs',
				import.meta.url
			).href;
			const resp = await fetch(url);
			const arrayBuf = await resp.arrayBuffer();
			const loadingTask = pdfjsLib.getDocument({ data: arrayBuf });
			const pdf = await loadingTask.promise;
			const clampedPage = Math.min(pageNumber, pdf.numPages);
			console.log(`[DocViewer] PDF has ${pdf.numPages} pages, rendering page ${clampedPage}`);
			const page = await pdf.getPage(clampedPage);
			const viewport = page.getViewport({ scale: 2 });
			const canvas = document.createElement('canvas');
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			const ctx = canvas.getContext('2d');
			await page.render({ canvasContext: ctx, viewport }).promise;
			console.log(`[DocViewer] Render complete for page ${clampedPage}, gen=${gen}, currentRenderGen=${renderGen}, genMatch=${gen === renderGen}`);
			if (gen !== renderGen) {
				console.log(`[DocViewer] STALE render discarded (gen ${gen} !== current ${renderGen})`);
				return;
			}
			pdfRenderUrl = canvas.toDataURL('image/png');
			pdfNatW = viewport.width;
			pdfNatH = viewport.height;
			console.log(`[DocViewer] pdfRenderUrl set for page ${clampedPage}`);
		} catch (e) {
			console.warn('[DocViewer] PDF render failed:', e);
			if (gen === renderGen) pdfRenderUrl = null;
		}
	}

	$effect(() => {
		const doc = selectedDoc;
		const hlPage = hl?.page;
		const needRender = isPdf && doc;
		console.log(`[DocViewer] effect fired: doc=${doc?.name || 'null'}, isPdf=${isPdf}, hlPage=${hlPage}, needRender=${needRender}`);
		if (needRender) {
			const pageNum = Number.isFinite(hlPage) && hlPage >= 1 ? Math.round(hlPage) : 1;
			const gen = ++renderGen;
			// Do not leave the previous page visible while the requested page renders.
			pdfRenderUrl = null;
			pdfNatW = 0;
			pdfNatH = 0;
			console.log(`[DocViewer] → calling renderPdfToImage page=${pageNum}, gen=${gen}`);
			renderPdfToImage(doc.url, pageNum, gen);
		} else {
			console.log(`[DocViewer] → clearing pdfRenderUrl`);
			pdfRenderUrl = null;
			pdfNatW = 0;
			pdfNatH = 0;
		}
	});

	$effect(() => {
		const el = docImgEl;
		if (!el) { frameW = 0; frameH = 0; return; }
		const ro = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (r) { frameW = r.width; frameH = r.height; }
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	function onImgLoad(e) {
		displayW = e.target.naturalWidth;
		displayH = e.target.naturalHeight;
	}

	function onPdfImgLoad(e) {
		displayW = e.target.naturalWidth;
		displayH = e.target.naturalHeight;
	}

	const box = $derived.by(() => {
		if (!hasBb) return null;
		const bb = hl.boundingBox;
		if (!docImgEl || displayW <= 0 || displayH <= 0) return null;
		if (frameW <= 0 || frameH <= 0) return null;

		const natW = isPdf ? pdfNatW : displayW;
		const natH = isPdf ? pdfNatH : displayH;

		const imgAspect = natW / natH;
		const frameAspect = frameW / frameH;
		let renderW, renderH, offsetX = 0, offsetY = 0;
		if (imgAspect > frameAspect) {
			renderW = frameW;
			renderH = frameW / imgAspect;
			offsetY = (frameH - renderH) / 2;
		} else {
			renderH = frameH;
			renderW = frameH * imgAspect;
			offsetX = (frameW - renderW) / 2;
		}
		const left = offsetX + bb.x * renderW;
		const top = offsetY + bb.y * renderH;
		const width = bb.width * renderW;
		const height = bb.height * renderH;
		// Large boxes (>4% normalized area) are imprecise — use pin indicator
		const isLarge = bb.width * bb.height > 0.04;
		return { left, top, width, height, isLarge };
	});
</script>

<section class="viewer">
	{#if selectedDoc}
		<div class="viewer-top">
			<span class="viewer-name">{selectedDoc.name}</span>
			{#if store.filledForm?.id === selectedDoc.id}
				<span class="viewer-tag form">Filled Form</span>
			{:else}
				<span class="viewer-tag attachment">Attachment</span>
			{/if}
			{#if hl}
				<button class="refresh-btn" title="Back to original view" onclick={clearHighlightField}>↻</button>
			{/if}
		</div>
		{#if hl}
			<div class="highlight-banner" class:mismatch={hl.status === 'mismatch'} class:match={hl.status === 'match'}>
				<div class="hl-content">
					<span class="hl-icon">🎯</span>
					<div class="hl-text">
						<span class="hl-field">{hl.fieldName}</span>
						<span class="hl-detail">
							Expected: <strong>{hl.expectedValue || '—'}</strong>
							{#if hl.formValue}
								<span class="hl-form-val">| Form has: <strong>{hl.formValue}</strong></span>
							{/if}
						</span>
					</div>
				</div>
				<button class="hl-dismiss" onclick={clearHighlightField}>✕</button>
			</div>
		{/if}

		<div class="viewer-frame">
			{#if isImage && selectedDoc}
				<div class="doc-container">
					<img
						bind:this={docImgEl}
						src={selectedDoc.url}
						alt={selectedDoc.name}
						onload={onImgLoad}
					/>
					{#if box}
						{#if box.isLarge}
							<div
								class="field-pin"
								style="left:{box.left + box.width / 2}px; top:{box.top + box.height / 2}px;"
							>
								<span class="field-label">{hl.fieldName}</span>
							</div>
						{:else}
							<div
								class="field-box"
								style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
							>
								<span class="field-label">{hl.fieldName}</span>
							</div>
						{/if}
					{/if}
				</div>
			{:else if isPdf && hasBb && pdfRenderUrl}
				<div class="doc-container">
					<img
						bind:this={docImgEl}
						src={pdfRenderUrl}
						alt="PDF page render"
						onload={onPdfImgLoad}
					/>
					{#if box}
						{#if box.isLarge}
							<div
								class="field-pin"
								style="left:{box.left + box.width / 2}px; top:{box.top + box.height / 2}px;"
							>
								<span class="field-label">{hl.fieldName}</span>
							</div>
						{:else}
							<div
								class="field-box"
								style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
							>
								<span class="field-label">{hl.fieldName}</span>
							</div>
						{/if}
					{/if}
				</div>
			{:else if isPdf}
				<object data={selectedDoc.url} type="application/pdf" aria-label={selectedDoc.name}>
					<iframe src={selectedDoc.url} title={selectedDoc.name}></iframe>
				</object>
			{/if}
		</div>
	{:else}
		<div class="empty">Select or upload a document to preview it here.</div>
	{/if}
</section>

<style>
	.viewer {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 16px;
		min-width: 0;
	}

	.viewer-top {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.refresh-btn {
		margin-left: auto;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid rgba(27, 43, 75, 0.2);
		background: #ffffff;
		color: #33415c;
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.refresh-btn:hover {
		background: #eef1f7;
		border-color: rgba(27, 43, 75, 0.35);
	}

	.viewer-name {
		font-size: 13px;
		font-weight: 700;
		color: #16233d;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.viewer-tag {
		font-size: 10px;
		font-weight: 800;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: 999px;
		flex: 0 0 auto;
	}

	.viewer-tag.form {
		background: #e2ecff;
		color: #1753c8;
	}

	.viewer-tag.attachment {
		background: #ffe7df;
		color: #ff714a;
	}

	.viewer-frame {
		flex: 1;
		border-radius: 10px;
		border: 1px solid rgba(27, 43, 75, 0.1);
		overflow: hidden;
		background: white;
	}

	.viewer-frame img,
	.viewer-frame object,
	.viewer-frame iframe {
		width: 100%;
		height: 100%;
		border: 0;
		object-fit: contain;
		display: block;
	}

	.doc-container {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.doc-container img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.field-box {
		position: absolute;
		border: 2.5px solid #e63946;
		border-radius: 4px;
		background: rgba(230, 57, 70, 0.1);
		box-shadow: 0 0 0 1px rgba(230, 57, 70, 0.15), 0 0 14px rgba(230, 57, 70, 0.25);
		pointer-events: none;
		animation: fieldBoxPulse 1.5s ease-in-out 3;
		z-index: 10;
	}

	.field-pin {
		position: absolute;
		transform: translate(-50%, -50%);
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #e63946;
		box-shadow: 0 0 0 2px white, 0 0 0 4px rgba(230, 57, 70, 0.4), 0 0 12px rgba(230, 57, 70, 0.5);
		pointer-events: none;
		animation: fieldBoxPulse 1.5s ease-in-out 3;
		z-index: 10;
	}

	.field-label {
		position: absolute;
		top: -20px;
		left: 0;
		background: #e63946;
		color: white;
		font-size: 9px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 3px;
		white-space: nowrap;
		pointer-events: none;
	}

	.empty {
		margin: auto;
		color: #a0a7b5;
		font-size: 13px;
	}

	.highlight-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 14px;
		margin-bottom: 8px;
		border-radius: 8px;
		font-size: 12px;
		animation: slideDown 0.3s ease-out;
	}

	.highlight-banner.mismatch {
		background: linear-gradient(135deg, #fff1f0, #ffe7e4);
		border: 1.5px solid rgba(196, 70, 61, 0.3);
	}

	.highlight-banner.match {
		background: linear-gradient(135deg, #f0fdf6, #e6f9ed);
		border: 1.5px solid rgba(30, 178, 100, 0.3);
	}

	.hl-content {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.hl-icon {
		font-size: 18px;
		flex-shrink: 0;
	}

	.hl-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.hl-field {
		font-weight: 800;
		color: #16233d;
		font-size: 13px;
	}

	.hl-detail {
		color: #6d7788;
		font-size: 11px;
	}

	.hl-detail strong {
		color: #16233d;
	}

	.hl-form-val {
		margin-left: 4px;
	}

	.hl-dismiss {
		background: none;
		border: none;
		color: #a0a7b5;
		font-size: 14px;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.hl-dismiss:hover {
		background: rgba(0, 0, 0, 0.06);
		color: #16233d;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fieldBoxPulse {
		0%, 100% {
			box-shadow: 0 0 0 1px rgba(230, 57, 70, 0.15), 0 0 8px rgba(230, 57, 70, 0.1);
		}
		50% {
			box-shadow: 0 0 0 2px rgba(230, 57, 70, 0.3), 0 0 20px rgba(230, 57, 70, 0.35);
		}
	}
</style>
