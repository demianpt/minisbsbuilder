(() => {
  const input = document.querySelector('#sbs-package');
  const label = document.querySelector('#sbs-file-name');
  const dropzone = document.querySelector('.sbs-dropzone');
  if (!input || !label || !dropzone) return;
  const update = () => { label.textContent = input.files?.[0]?.name || 'No file selected'; };
  input.addEventListener('change', update);
  ['dragenter', 'dragover'].forEach((event) => dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((event) => dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.remove('is-dragging'); }));
  dropzone.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const transfer = new DataTransfer();
    transfer.items.add(e.dataTransfer.files[0]);
    input.files = transfer.files;
    update();
  });
})();
