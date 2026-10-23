<script>
	import { compareFilledFormWithAttachments } from '../lib/compare/compareFilledForm.js';
	import { generateReportPdf } from '../lib/pdf/reportPdf.js';
	import { acceptResult, rejectResult, resetResult, setHighlightField, store, submitToJpn } from '../lib/store.svelte.js';

	const canCompare = $derived(
		Boolean(store.filledForm) && store.attachments.length > 0 && !store.comparing
	);

	const visibleChecks = $derived(
		store.result ? store.result.checks : []
	);

	let filterStatus = $state('all');

	const filteredChecks = $derived(
		filterStatus === 'all'
			? visibleChecks
			: visibleChecks.filter((c) => c.status === filterStatus)
	);

	const counts = $derived.by(() => {
		let match = 0, mismatch = 0, unverified = 0;
		for (const c of visibleChecks) {
			if (c.status === 'match') match++;
			else if (c.status === 'mismatch') mismatch++;
			else unverified++;
		}
		return { match, mismatch, unverified };
	});

	const sectionOrder = [
		"Child's Information",
		"Father's Information",
		"Mother's Information",
		"Informant's Information",
		"Witness's Information",
		"Birth Registration Details",
	];

	const specialFields = new Set([
		"Child's Date of Birth",
		"Child's Time of Birth",
	]);

	function sortGroupChecks(checks) {
		return [...checks].sort((a, b) => {
			const isASpecial = specialFields.has(a.field);
			const isBSpecial = specialFields.has(b.field);
			if (isASpecial && !isBSpecial) return 1;
			if (!isASpecial && isBSpecial) return -1;
			return 0;
		});
	}

	const groupedChecks = $derived.by(() => {
		const groups = new Map();
		for (const check of filteredChecks) {
			let section = 'Other';
			for (const s of sectionOrder) {
				if (check.field.startsWith(s.split(' ')[0])) {
					section = s;
					break;
				}
			}
			if (section === 'Other') {
				const match = check.field.match(/^(\w+)'s\b/i);
				if (match) section = `${match[1]}'s Information`;
			}
			if (!groups.has(section)) groups.set(section, []);
			groups.get(section).push(check);
		}
		const ordered = [];
		for (const s of sectionOrder) {
			if (groups.has(s)) {
				ordered.push({ title: s, checks: sortGroupChecks(groups.get(s)) });
				groups.delete(s);
			}
		}
		for (const [title, checks] of groups) {
			ordered.push({ title, checks: sortGroupChecks(checks) });
		}
		return ordered;
	});

	let isDownloading = $state(false);
	let abortController = $state(null);
	let scanProgress = $state(0);
	let scanTimeout = $state(null);
	let scanStartTime = 0;

	function progressIncrement(current) {
		if (current < 30) return Math.random() * 4 + 3;
		if (current < 60) return Math.random() * 3 + 1.5;
		if (current < 80) return Math.random() * 1.5 + 0.5;
		if (current < 88) return Math.random() * 0.3 + 0.1;
		return Math.random() * 0.1 + 0.02;
	}

	function tickProgress() {
		const elapsed = (Date.now() - scanStartTime) / 1000;
		const delay = elapsed < 8 ? 350 : 700;
		scanProgress = Math.min(scanProgress + progressIncrement(scanProgress), 92);
		scanTimeout = setTimeout(tickProgress, delay);
	}

	async function runCompare() {
		if (!store.filledForm || !store.attachments.length) return;

		const controller = new AbortController();
		abortController = controller;
		store.comparing = true;
		scanProgress = 0;
		scanStartTime = Date.now();
		resetResult();
		tickProgress();

		try {
			store.result = await compareFilledFormWithAttachments(
				store.filledForm.file,
				store.attachments.map((a) => a.file),
				{ signal: controller.signal }
			);
		} catch (error) {
			if (error.name === 'AbortError') {
				store.error = 'Comparison cancelled.';
			} else {
				store.error = error instanceof Error ? error.message : 'Comparison failed.';
			}
		} finally {
			clearTimeout(scanTimeout);
			scanProgress = 0;
			abortController = null;
			store.comparing = false;
		}
	}

	function cancelCompare() {
		if (abortController) {
			abortController.abort();
		}
	}

	function openSourceAttachment(sourceName, check) {
		if (!sourceName) return;
		const stripped = sourceName.replace(/^Attachment\s*\d+:\s*/i, '').trim();
		const match = store.attachments.find(
			(a) => a.name === stripped
				|| a.name.toLowerCase() === stripped.toLowerCase()
				|| a.name === sourceName
				|| a.name.toLowerCase() === sourceName.toLowerCase()
		);
		if (match) {
			store.selectedId = match.id;
			setHighlightField({
				fieldName: check.field,
				expectedValue: check.attachmentValue,
				formValue: check.formValue,
				status: check.status,
				source: sourceName,
				boundingBox: check.attachmentBoundingBox || null,
				page: check.page || 1,
			});
		}
	}

	async function printReport() {
		if (!store.result) return;
		isDownloading = true;
		try {
			generateReportPdf(store.result, store.filledForm?.name);
		} finally {
			isDownloading = false;
		}
	}
</script>

<section class="result-panel">
	<div class="result-top">
		<h3>Comparison</h3>
		{#if !store.result}
			<button class="compare-btn" disabled={!canCompare} onclick={runCompare}>
				{store.comparing ? 'Comparing…' : '⇄ Compare'}
			</button>
		{/if}
	</div>

	{#if !store.filledForm || !store.attachments.length}
		<p class="hint">Upload at least one attachment (ground truth) and one filled form to compare.</p>
	{:else if store.error}
		<div class="banner fail">⚠ {store.error}</div>
	{:else if store.comparing}
		<div class="scan-state">
			<div class="scan-icon-wrap">
				<svg class="scan-icon" xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" fill="none">
					<path fill="#010101" d="M8 8h14v2H8zM152 8h-14v2h14z"/>
					<path fill="#010101" d="M10 8v14H8V8zM150 8v14h2V8zM8 152h14v-2H8zM152 152h-14v-2h14z"/>
					<path fill="#010101" d="M10 152v-14H8v14zM150 152v-14h2v14z"/>
					<g opacity="0.6">
						<path d="M41 34h84v100H41V34z" fill="url(#lp0)"/>
						<path d="M41 34v-.3h-.3v.3h.3zm84 0h.3v-.3h-.3v.3zm0 100v.3h.3v-.3h-.3zm-84 0h-.3v.3h.3v-.3zm0-100v.3h84v-.6H41v.3zm84 0h-.3v100h.6V34h-.3zm0 100v-.3H41v.6h84v-.3zm-84 0h.3V34h-.6v100h.3z" fill="#000"/>
					</g>
					<path d="M37 32h84v98H37V32z" fill="url(#lp1)"/>
					<path d="M121 130v.3h.3v-.3h-.3zm-84 0h-.3v.3h.3v-.3zm84-98h-.3v98h.6V32h-.3zm0 98v-.3H37v.6h84v-.3zm-84 0h.3V32h-.6v98h.3z" fill="#000"/>
					<path fill="#010101" d="M37 25h84v7H37z"/>
					<circle cx="43" cy="28.587" r="1" fill="#fff"/>
					<circle cx="48" cy="28.587" r="1" fill="#fff"/>
					<circle cx="53" cy="28.587" r="1" fill="#fff"/>
					<path d="M83.85 49A3.85 3.85 0 0180 52.85H53a3.85 3.85 0 110-7.7h27A3.85 3.85 0 0183.85 49z" fill="#fff" stroke="#000" stroke-width="0.3"/>
					<rect x="83.85" y="58.15" width="7.7" height="34.7" rx="3.85" transform="rotate(90 83.85 58.15)" fill="#fff" stroke="#000" stroke-width="0.3"/>
					<path d="M50 72h32" stroke="#000" stroke-width="0.3"/>
					<path d="M91 116L69 85l-21 31h43z" fill="#fff" stroke="#000" stroke-width="0.24"/>
					<path d="M110 116L93 91l-17 25h34z" fill="#000" stroke="#000" stroke-width="0.24"/>
					<circle cx="100" cy="88" r="4" fill="#fff" stroke="#000" stroke-width="0.24"/>
					<g class="laser-beam" transform="translate(10 64)">
						<path fill="#4658FF" d="M0 30h140v3H0z"/>
						<path fill="url(#lcg)" d="M0 0h140v30H0z"/>
					</g>
					<defs>
						<linearGradient id="lp0" x1="83" y1="34" x2="83" y2="134" gradientUnits="userSpaceOnUse">
							<stop stop-color="#fff"/>
							<stop offset="1" stop-color="#B3C1FE"/>
						</linearGradient>
						<linearGradient id="lp1" x1="79" y1="32" x2="79" y2="130" gradientUnits="userSpaceOnUse">
							<stop stop-color="#fff"/>
							<stop offset="1" stop-color="#7C91EE"/>
						</linearGradient>
						<linearGradient id="lcg" x1="80" y1="36" x2="80" y2="0" gradientUnits="userSpaceOnUse">
							<stop stop-color="#4658FF" stop-opacity="0.38"/>
							<stop offset="1" stop-color="#4658FF" stop-opacity="0"/>
						</linearGradient>
					</defs>
				</svg>
			</div>
			<p class="scan-label">Analyzing documents…</p>
			<p class="scan-sublabel">Reading fields and comparing values</p>
			<div class="progress-wrap">
				<span class="progress-pct">{Math.round(scanProgress)}%</span>
				<div class="progress-bar-track">
					<div class="progress-bar-fill" style="width: {scanProgress}%"></div>
				</div>
			</div>
			<button class="cancel-btn" onclick={cancelCompare}>Cancel Processing</button>
		</div>
	{:else if store.result}
		<div
			class="banner"
			class:pass={store.result.overallStatus === 'pass'}
			class:fail={store.result.overallStatus === 'fail'}
			class:neutral={store.result.overallStatus === 'unverifiable'}
		>
			{#if store.result.overallStatus === 'pass'}
				✓ All matched
			{:else if store.result.overallStatus === 'fail'}
				⚠ Mismatch found
			{:else}
				ℹ {store.result.summary}
			{/if}
		</div>

		<div class="counts-row">
			<span class="count match">{counts.match} match</span>
			<span class="count mismatch">{counts.mismatch} mismatch</span>
			<span class="count unverified">{counts.unverified} unverified</span>
		</div>

		<div class="filter-row">
			<button class="filter-btn" class:active={filterStatus === 'all'} onclick={() => filterStatus = 'all'}>All</button>
			<button class="filter-btn match" class:active={filterStatus === 'match'} onclick={() => filterStatus = 'match'}>Match</button>
			<button class="filter-btn mismatch" class:active={filterStatus === 'mismatch'} onclick={() => filterStatus = 'mismatch'}>Mismatch</button>
			<button class="filter-btn unverified" class:active={filterStatus === 'unverifiable'} onclick={() => filterStatus = 'unverifiable'}>Unverified</button>
		</div>

		{#if groupedChecks.length}
			<div class="sections">
				{#each groupedChecks as group}
					<div class="section">
						<h4 class="section-title">{group.title}</h4>
						<ul class="checks">
							{#each group.checks as check}
								<li
									class="check"
									class:match={check.status === 'match'}
									class:mismatch={check.status === 'mismatch'}
									class:unverified={check.status === 'unverifiable'}
								>
									<div class="check-head">
										<span class="field-name">{check.field}</span>
										<span class="status-pill">{check.status === 'unverifiable' ? 'unverified' : check.status}</span>
									</div>
									<div class="check-row"><span class="label-form">Form:</span> <strong>{check.formValue || '—'}</strong></div>
									<div class="check-row">
										<span class="label-attachment">Attachment:</span> <strong>{check.attachmentValue || '—'}</strong>
										{#if check.source}
											<button class="source-link" onclick={() => openSourceAttachment(check.source, check)}>
												({check.source})
											</button>
										{/if}
									</div>
									{#if check.note}<div class="check-note">{check.note}</div>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="hint">Click Compare to check the filled form against your attachments.</p>
	{/if}
	{#if store.result && !store.jpnRegistration}
		<div class="decision-row">
			<button class="decision-btn accept" class:active={store.decision === 'accepted'} onclick={() => { acceptResult(); submitToJpn(); }}>
				✓ Accept
			</button>
			<button class="decision-btn reject" class:active={store.decision === 'rejected'} onclick={() => { rejectResult(); printReport(); }}>
				✕ Reject
			</button>
		</div>
	{/if}

	{#if store.jpnRegistration?.status === 'loading'}
		<div class="jpn-loading">
			<div class="jpn-spinner"></div>
			<span>Submitting to JPN server…</span>
		</div>
	{/if}

	<div id="printable-report" class="printable-report">
		{#if store.result}
			<h1>ZARA — Form Verification Report</h1>
			<p class="report-meta">
				Form: <strong>{store.filledForm?.name}</strong><br />
				Checked on: {new Date().toLocaleString()}
			</p>
			<p class="report-status" class:pass={store.result.overallStatus === 'pass'} class:fail={store.result.overallStatus === 'fail'}>
				{store.result.overallStatus === 'pass'
					? 'PASSED — all fields matched'
					: store.result.overallStatus === 'fail'
						? 'REJECTED — mismatches found, see below'
						: 'UNVERIFIABLE'}
			</p>

			{#if store.result.checks.some((c) => c.status === 'mismatch')}
				<h2>Fields that need correction</h2>
				<table class="report-table">
					<thead>
						<tr><th>Field</th><th>Value on Form</th><th>Should Be (per attachment)</th><th>Note</th></tr>
					</thead>
					<tbody>
						{#each store.result.checks.filter((c) => c.status === 'mismatch') as c}
							<tr>
								<td>{c.field}</td>
								<td>{c.formValue}</td>
								<td>{c.attachmentValue}</td>
								<td>{c.note}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<h2>All checked fields</h2>
			<table class="report-table">
				<thead>
					<tr><th>Field</th><th>Value on Form</th><th>Value on Attachment</th><th>Result</th></tr>
				</thead>
				<tbody>
					{#each store.result.checks as c}
						<tr>
							<td>{c.field}</td>
							<td>{c.formValue}</td>
							<td>{c.attachmentValue}</td>
							<td>{c.status}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</section>

<style>
	.result-panel {
		width: 380px;
		max-width: 380px;
		border-left: 1px solid rgba(27, 43, 75, 0.08);
		padding: 16px;
		overflow-y: auto;
		background: #fafbfd;
	}

	.result-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}

	.result-top h3 {
		margin: 0;
		font-size: 14px;
		color: #16233d;
	}

	.compare-btn {
		border: 0;
		border-radius: 8px;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 700;
		background: linear-gradient(180deg, #123b84, #0c2f72);
		color: white;
		cursor: pointer;
	}

	.compare-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		font-size: 12px;
		color: #8390a6;
	}

	.scan-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 160px 16px 80px;
		gap: 12px;
	}

	.scan-icon-wrap {
		width: 120px;
		height: 120px;
		position: relative;
		overflow: visible;
	}

	.scan-icon {
		width: 100%;
		height: 100%;
	}

	.laser-beam {
		animation: laserMove 2.5s ease-in-out infinite;
		transform-origin: 80px 94px;
	}

	@keyframes laserMove {
		0%   { transform: translateY(-60px); }
		50%  { transform: translateY(110px); }
		100% { transform: translateY(-60px); }
	}

	.scan-label {
		font-size: 13px;
		font-weight: 700;
		color: #16233d;
		margin: 0;
	}

	.scan-sublabel {
		font-size: 11px;
		color: #8390a6;
		margin: 0;
		text-align: center;
	}

	.progress-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
	}

	.progress-bar-track {
		width: 200px;
		height: 6px;
		border-radius: 3px;
		background: rgba(18, 59, 132, 0.1);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: 3px;
		background: linear-gradient(90deg, #123b84, #1e6dd4);
		transition: width 0.4s ease;
	}

	.progress-pct {
		font-size: 11px;
		font-weight: 700;
		color: #123b84;
		margin: 0;
	}

	.cancel-btn {
		margin-top: 12px;
		border: 1.5px solid #c0463d;
		border-radius: 8px;
		padding: 10px 24px;
		font-size: 12px;
		font-weight: 700;
		color: #a3352b;
		background: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-btn:hover {
		background: #a3352b;
		color: white;
	}

	.banner {
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13px;
		font-weight: 700;
		margin-bottom: 12px;
	}

	.banner.pass {
		background: #dff5e8;
		color: #17804f;
	}

	.banner.fail {
		background: #ffe1dd;
		color: #a3352b;
	}

	.banner.neutral {
		background: #eef1f7;
		color: #6d7788;
	}

	.counts-row {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		font-size: 11px;
		font-weight: 700;
	}

	.count {
		padding: 3px 8px;
		border-radius: 6px;
	}

	.count.match {
		background: #dff5e8;
		color: #17804f;
	}

	.count.mismatch {
		background: #ffe1dd;
		color: #a3352b;
	}

	.count.unverified {
		background: #eef1f7;
		color: #6d7788;
	}

	.filter-row {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
	}

	.filter-btn {
		flex: 1;
		padding: 6px 0;
		border: 1.5px solid #d0d5e0;
		border-radius: 6px;
		background: white;
		color: #6d7788;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-btn:hover {
		border-color: #123b84;
		color: #123b84;
	}

	.filter-btn.active {
		background: #123b84;
		border-color: #123b84;
		color: white;
	}

	.filter-btn.match.active {
		background: #17804f;
		border-color: #17804f;
	}

	.filter-btn.mismatch.active {
		background: #a3352b;
		border-color: #a3352b;
	}

	.filter-btn.unverified.active {
		background: #6d7788;
		border-color: #6d7788;
	}

	.checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.section-title {
		margin: 0 0 6px;
		font-size: 12px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #16233d;
		padding-bottom: 4px;
		border-bottom: 1px solid rgba(27, 43, 75, 0.1);
	}

	.check {
		border-radius: 8px;
		border: 1px solid rgba(27, 43, 75, 0.1);
		padding: 8px 10px;
		font-size: 12px;
	}

	.check.match {
		background: rgba(30, 178, 100, 0.06);
	}

	.check.mismatch {
		background: rgba(196, 70, 61, 0.08);
		border-color: rgba(196, 70, 61, 0.3);
	}

	.check.unverified {
		background: rgba(141, 150, 168, 0.06);
		opacity: 0.7;
	}

	.check-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.field-name {
		font-weight: 700;
		color: #16233d;
	}

	.status-pill {
		font-size: 10px;
		font-weight: 800;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 999px;
	}

	.check.match .status-pill {
		background: #dff5e8;
		color: #17804f;
	}

	.check.mismatch .status-pill {
		background: #ffe1dd;
		color: #a3352b;
	}

	.check.unverified .status-pill {
		background: #eef1f7;
		color: #6d7788;
	}

	.check-row {
		color: #33415c;
		margin-top: 2px;
	}

	.check-row .label-form {
		color: #a35520;
		font-weight: 600;
	}

	.check-row .label-attachment {
		color: #17804f;
		font-weight: 600;
	}

	.check-note {
		margin-top: 4px;
		color: #6d7788;
		font-style: italic;
	}

	.source-link {
		background: none;
		border: none;
		color: #123b84;
		font-size: inherit;
		font-style: italic;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		text-decoration-style: dotted;
	}

	.source-link:hover {
		color: #0c2f72;
		text-decoration-style: solid;
	}

	.decision-row {
		position: sticky;
		bottom: -16px;
		margin-left: -16px;
		margin-right: -16px;
		padding: 12px 16px 16px;
		display: flex;
		gap: 8px;
		border-top: 1px solid rgba(27, 43, 75, 0.1);
		background: rgba(250, 251, 253, 0.94);
		backdrop-filter: blur(6px);
		z-index: 20;
	}

	.decision-btn {
		flex: 1;
		border-radius: 8px;
		padding: 10px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		border: 1.5px solid;
	}

	.decision-btn.accept {
		border-color: #1eb264;
		background: white;
		color: #17804f;
	}

	.decision-btn.accept.active {
		background: #17804f;
		color: white;
	}

	.decision-btn.reject {
		border-color: #c0463d;
		background: white;
		color: #a3352b;
	}

	.decision-btn.reject.active {
		background: #a3352b;
		color: white;
	}

	.jpn-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 20px;
		color: #4a5568;
		font-size: 13px;
	}

	.jpn-spinner {
		width: 20px;
		height: 20px;
		border: 2.5px solid #e2ecff;
		border-top-color: #123b84;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.jpn-card {
		margin-top: 12px;
		border: 1.5px solid #c6f0d8;
		border-radius: 10px;
		background: linear-gradient(135deg, #f0fdf6, #e6f9ed);
		overflow: hidden;
		animation: slideDown 0.35s ease-out;
	}

	.jpn-card-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid rgba(30, 178, 100, 0.15);
		background: rgba(30, 178, 100, 0.06);
	}

	.jpn-icon {
		font-size: 22px;
		flex-shrink: 0;
	}

	.jpn-title {
		font-weight: 800;
		font-size: 14px;
		color: #14532d;
	}

	.jpn-subtitle {
		font-size: 11px;
		color: #4a7c5c;
		margin-top: 1px;
	}

	.jpn-fields {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.jpn-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.jpn-label {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		color: #6d7788;
		letter-spacing: 0.4px;
	}

	.jpn-value {
		font-size: 15px;
		font-weight: 700;
		color: #16233d;
	}

	.jpn-sub {
		font-size: 11px;
		color: #4a5568;
	}

	.jpn-sub strong {
		color: #123b84;
		font-family: monospace;
		font-size: 12px;
	}

	.printable-report {
		display: none;
	}

	@media print {
		:global(body *) {
			visibility: hidden;
		}
		:global(#printable-report),
		:global(#printable-report *) {
			visibility: visible;
		}
		:global(#printable-report) {
			display: block !important;
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			padding: 24px;
		}
	}

	.report-meta {
		font-size: 13px;
		color: #33415c;
	}

	.report-status {
		font-weight: 800;
		font-size: 14px;
		padding: 8px 12px;
		border-radius: 6px;
		display: inline-block;
	}

	.report-status.pass {
		background: #dff5e8;
		color: #17804f;
	}

	.report-status.fail {
		background: #ffe1dd;
		color: #a3352b;
	}

	.report-table {
		width: 100%;
		border-collapse: collapse;
		margin: 10px 0 20px;
		font-size: 12px;
	}

	.report-table th,
	.report-table td {
		border: 1px solid #ccc;
		padding: 6px 8px;
		text-align: left;
	}

	.report-table th {
		background: #f0f0f0;
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
</style>
