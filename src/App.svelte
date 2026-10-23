<script>
	import Sidebar from './components/Sidebar.svelte';
	import DocumentViewer from './components/DocumentViewer.svelte';
	import ComparisonResult from './components/ComparisonResult.svelte';
	import { store } from './lib/store.svelte.js';
</script>

<svelte:head>
	<title>ZARA - Document Comparison</title>
</svelte:head>

<div class="app-shell">
	<Sidebar />
	{#if store.jpnRegistration?.status === 'success'}
		<div class="success-center">
			<div class="jpn-card">
				<div class="jpn-card-header">
					<span class="jpn-icon">✅</span>
					<div>
						<div class="jpn-title">Registration Successful</div>
						<div class="jpn-subtitle">Jabatan Pendaftaran Negara</div>
					</div>
				</div>
				<div class="jpn-fields">
					<div class="jpn-field">
						<span class="jpn-label">No. Daftar Kelahiran</span>
						<span class="jpn-value">{store.jpnRegistration.no_daftar_kelahiran}</span>
					</div>
					<div class="jpn-field">
						<span class="jpn-label">Child ID (MyKid)</span>
						<span class="jpn-value">{store.jpnRegistration.child_id}</span>
					</div>
					<div class="jpn-field">
						<span class="jpn-label">Certificate Collection</span>
						<span class="jpn-value">{store.jpnRegistration.certificate_collection.venue}</span>
						<span class="jpn-sub">Available from: {store.jpnRegistration.certificate_collection.available_from}</span>
						<span class="jpn-sub">Collection Code: <strong>{store.jpnRegistration.certificate_collection.collection_code}</strong></span>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<DocumentViewer />
	{/if}
	<ComparisonResult />
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
		background: #eef1f7;
		color: #132033;
	}

	:global(html, body, #app) {
		height: 100%;
	}

	.app-shell {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.success-center {
		flex: 1;
		display: flex;
		justify-content: flex-start;
		align-items: flex-start;
		background: #ffffff;
		overflow-y: auto;
		min-width: 0;
		padding: 24px;
		border-right: 1px solid rgba(27, 43, 75, 0.08);
	}

	.jpn-card {
		width: 380px;
		background: #ffffff;
		border: 1px solid rgba(30, 178, 100, 0.35);
		border-radius: 12px;
		box-shadow: 0 6px 20px rgba(30, 178, 100, 0.12);
		overflow: hidden;
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
</style>

