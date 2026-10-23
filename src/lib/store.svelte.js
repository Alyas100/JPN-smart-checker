/**
 * Shared app state. Svelte 5 lets $state live outside components in a
 * `.svelte.js` file — import `store` anywhere and mutate it directly,
 * every component using it re-renders automatically.
 */
export const store = $state({
  attachments: [],
  filledForm: null,
  selectedId: null,

  comparing: false,
  result: null,
  error: "",
  decision: null, // 'accepted' | 'rejected' | null
  highlightField: null, // { fieldName, expectedValue, formValue, status, source, boundingBox, page } | null
  jpnRegistration: null, // mock JPN server response
});

export function addAttachment(file) {
  const id = crypto.randomUUID();
  store.attachments.push({
    id,
    file,
    url: URL.createObjectURL(file),
    name: file.name,
  });
  store.selectedId = id;
  resetResult();
  return id;
}

export function removeAttachment(id) {
  const index = store.attachments.findIndex((a) => a.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(store.attachments[index].url);
  store.attachments.splice(index, 1);
  if (store.selectedId === id) store.selectedId = null;
  resetResult();
}

export function setFilledForm(file) {
  if (store.filledForm?.url) URL.revokeObjectURL(store.filledForm.url);
  const id = crypto.randomUUID();
  store.filledForm = {
    id,
    file,
    url: URL.createObjectURL(file),
    name: file.name,
  };
  store.selectedId = id;
  resetResult();
  return id;
}

export function removeFilledForm() {
  if (!store.filledForm) return;
  URL.revokeObjectURL(store.filledForm.url);
  if (store.selectedId === store.filledForm.id) store.selectedId = null;
  store.filledForm = null;
  resetResult();
}

export function resetResult() {
  store.result = null;
  store.error = "";
  store.decision = null;
  store.jpnRegistration = null;
}

export function acceptResult() {
  store.decision = "accepted";
}

/** Simulate JPN server registration — returns mock data after a fake delay. */
export async function submitToJpn() {
  store.jpnRegistration = { status: "loading" };
  await new Promise((r) => setTimeout(r, 2000));
  const now = new Date();
  const collectDate = new Date(now);
  collectDate.setDate(collectDate.getDate() + 14);
  store.jpnRegistration = {
    status: "success",
    no_daftar_kelahiran: "2026 / 0048231",
    child_id: "260827-14-5672",
    certificate_collection: {
      venue: "Jabatan Pendaftaran Negara, Putrajaya",
      available_from: collectDate.toLocaleDateString("en-MY", {
        day: "2-digit", month: "long", year: "numeric",
      }),
      collection_code: "JPN-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
    },
  };
}

export function rejectResult() {
  store.decision = "rejected";
}

export function selectDocument(id) {
  store.selectedId = id;
}

export function setHighlightField(info) {
  store.highlightField = info;
}

export function clearHighlightField() {
  store.highlightField = null;
}

export function getSelectedDocument() {
  if (store.filledForm?.id === store.selectedId) return store.filledForm;
  return store.attachments.find((a) => a.id === store.selectedId) ?? null;
}
