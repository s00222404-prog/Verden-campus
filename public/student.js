const $ = (id) => document.getElementById(id);
let activeSession = null;
let submitted = false;
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function showMessage(text = '') { $('student-message').textContent = text; }
$('pin').addEventListener('input', () => { $('pin').value = $('pin').value.replace(/\D/g, '').slice(0, 4); });
$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pin = $('pin').value.trim();
  if (!/^\d{4}$/.test(pin)) return showMessage('Enter all 4 digits of the session PIN.');
  showMessage('Checking session…');
  try {
    const data = await api('/api/student/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    activeSession = { id: data.id, pin };
    $('assignment-title').textContent = data.assignmentName || 'Assignment';
    $('assignment-link').href = data.assignmentUrl;
    $('assignment-panel').classList.remove('hidden');
    showMessage('');
    $('assignment-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showMessage(error.message); }
});
$('submission-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeSession || submitted) return;
  const file = $('student-file').files[0];
  const answer = $('answer-text').value.trim();
  if (!answer && !file) return showMessage('Write an answer or attach your completed work.');
  if (file && file.size > 5 * 1024 * 1024) return showMessage('File is larger than 5 MB.');
  const button = $('submit-work'); button.disabled = true; button.textContent = 'Submitting…';
  const form = new FormData();
  form.append('pin', activeSession.pin);
  form.append('studentName', $('student-name').value.trim());
  form.append('answerText', answer);
  if (file) form.append('file', file);
  try {
    await api('/api/student/session/' + activeSession.id + '/submissions', { method: 'POST', body: form });
    submitted = true;
    $('submission-form').classList.add('hidden');
    $('submitted-state').classList.remove('hidden');
    showMessage('');
  } catch (error) {
    button.disabled = false; button.textContent = 'Submit work';
    showMessage(error.message);
  }
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
