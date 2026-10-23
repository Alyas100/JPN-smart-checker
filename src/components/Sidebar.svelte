<script>
	import {
	  addAttachment,
	  removeAttachment,
	  removeFilledForm,
	  selectDocument,
	  setFilledForm,
	  store
	} from '../lib/store.svelte.js';

	let attachmentInput = $state(null);
	let formInput = $state(null);

	function openAttachmentPicker() {
		if (attachmentInput) attachmentInput.value = '';
		attachmentInput?.click();
	}

	function openFormPicker() {
		if (formInput) formInput.value = '';
		formInput?.click();
	}

	function handleAttachmentChange(event) {
		const files = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = '';
		for (const file of files) addAttachment(file);
	}

	function handleFormChange(event) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (file) setFilledForm(file);
	}
</script>

<aside class="sidebar">
	<div class="brand">ZARA <span class="beta">Beta</span></div>

	<input
		bind:this={attachmentInput}
		type="file"
		accept=".pdf,.png,.jpg,.jpeg"
		multiple
		hidden
		onchange={handleAttachmentChange}
	/>
	<input
		bind:this={formInput}
		type="file"
		accept=".pdf,.png,.jpg,.jpeg"
		hidden
		onchange={handleFormChange}
	/>

	<button class="btn primary" onclick={openAttachmentPicker}>+ Upload Attachment</button>
	<button class="btn secondary" onclick={openFormPicker}>📝 Upload Filled Form</button>

	<h4>Attachments <span class="hint">(ground truth)</span></h4>
	{#if store.attachments.length}
		<ul class="doc-list">
			{#each store.attachments as a (a.id)}
				<li class:selected={a.id === store.selectedId}>
					<button class="doc-item" onclick={() => selectDocument(a.id)}>{a.name}</button>
					<button class="remove" onclick={() => removeAttachment(a.id)} aria-label="remove attachment">✕</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No attachments yet</p>
	{/if}

	<h4>Filled Form</h4>
	{#if store.filledForm}
		<ul class="doc-list">
			<li class:selected={store.filledForm.id === store.selectedId}>
				<button class="doc-item" onclick={() => selectDocument(store.filledForm.id)}>
					{store.filledForm.name}
				</button>
				<button class="remove" onclick={() => removeFilledForm()} aria-label="remove filled form">✕</button>
			</li>
		</ul>
	{:else}
		<p class="empty">No form uploaded yet</p>
	{/if}
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: #f4f6fa;
		border-right: 1px solid rgba(20, 36, 73, 0.08);
		min-width: 260px;
		max-width: 260px;
		overflow-y: auto;
	}

	.brand {
		font-weight: 800;
		font-size: 16px;
		color: #16233d;
		margin-bottom: 8px;
	}

	.brand .beta {
		font-size: 10px;
		font-weight: 700;
		color: #6d7788;
		border: 1px solid rgba(27, 43, 75, 0.16);
		border-radius: 999px;
		padding: 2px 6px;
		margin-left: 4px;
	}

	.btn {
		border: 0;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}

	.btn.primary {
		background: linear-gradient(180deg, #123b84, #0c2f72);
		color: white;
	}

	.btn.secondary {
		background: white;
		color: #10357c;
		border: 1.5px dashed rgba(16, 53, 124, 0.4);
	}

	h4 {
		margin: 12px 0 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #8390a6;
		display: flex;
		gap: 4px;
		align-items: baseline;
	}

	h4 .hint {
		text-transform: none;
		font-weight: 400;
		font-size: 10px;
	}

	.doc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.doc-list li {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.doc-item {
		flex: 1;
		text-align: left;
		border: 1px solid rgba(27, 43, 75, 0.1);
		background: white;
		border-radius: 7px;
		padding: 8px 10px;
		font-size: 12px;
		color: #33415c;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	li.selected .doc-item {
		border-color: #123b84;
		background: #eaf0ff;
	}

	.remove {
		border: 0;
		background: transparent;
		color: #a3352b;
		font-size: 11px;
		cursor: pointer;
		flex: 0 0 auto;
	}

	.empty {
		font-size: 12px;
		color: #a0a7b5;
		margin: 4px 0;
	}
</style>