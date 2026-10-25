const $ = (id) => document.getElementById(id);
const state = { id: null, token: null, pin: null, timer: null, seen: new Set() };
const message = (id, text = '') => { $(id).textContent = text; };
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
$('open-session').addEventListener('click', async () => {
  const key = $('teacher-key').value.trim();
  if (!key) return message('teacher-message', 'Enter your teacher access key first.');
  $('open-session').disabled = true;
  message('teacher-message', 'Opening a secure session…');
  try {
    const data = await api('/api/teacher/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-teacher-key': key }, body: '{}' });
    state.id = data.id; state.token = data.teacherToken; state.pin = data.pin;
    $('session-pin').textContent = data.pin;
    $('session-expiry').textContent = 'Session expires ' + new Date(data.expiresAt).toLocaleString();
    $('session-panel').classList.remove('hidden');
    $('assignment-file').disabled = false;
    message('teacher-message', '');
    $('session-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await refreshSubmissions();
    state.timer = setInterval(refreshSubmissions, 12000);
  } catch (error) { message('teacher-message', error.message); }
  finally { $('open-session').disabled = false; }
});
$('assignment-file').addEventListener('change', () => {
  const file = $('assignment-file').files[0];
  $('upload-assignment').disabled = !file;
  $('assignment-state').textContent = file ? file.name + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' MB' : 'No assignment uploaded yet.';
});
$('upload-assignment').addEventListener('click', async () => {
  const file = $('assignment-file').files[0];
  if (!file || !state.id) return;
  if (file.size > 5 * 1024 * 1024) return message('teacher-message', 'File is larger than 5 MB.');
  $('upload-assignment').disabled = true;
  try {
    const form = new FormData(); form.append('file', file);
    await api('/api/teacher/sessions/' + state.id + '/assignment', { method: 'POST', headers: { 'x-teacher-token': state.token }, body: form });
    $('assignment-state').textContent = 'Uploaded: ' + file.name;
    message('teacher-message', 'Assignment uploaded successfully.');
  } catch (error) { message('teacher-message', error.message); }
  finally { $('upload-assignment').disabled = !file; }
});
async function refreshSubmissions() {
  if (!state.id || !state.token) return;
  try {
    const data = await api('/api/teacher/sessions/' + state.id + '/submissions', { headers: { 'x-teacher-token': state.token } });
    const root = $('submissions');
    if (!data.submissions.length) { root.innerHTML = '<p class="empty">No submissions yet. New work will appear here.</p>'; return; }
    root.replaceChildren();
    data.submissions.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'submission-card' + (!item.opened_at ? ' unread' : '');
      const title = document.createElement('h3'); title.textContent = item.student_name || 'Student';
      if (!item.opened_at) { const dot = document.createElement('span'); dot.className = 'unread-dot'; dot.title = 'Unread'; title.append(dot); }
      const meta = document.createElement('p'); meta.className = 'submission-meta'; meta.textContent = new Date(item.created_at).toLocaleString();
      card.append(title, meta);
      if (item.answer_text) { const body = document.createElement('p'); body.className = 'submission-text'; body.textContent = item.answer_text; card.append(body); }
      if (item.fileUrl) { const link = document.createElement('a'); link.className = 'submission-file'; link.href = item.fileUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open attached work ↗'; link.addEventListener('click', () => markOpened(item.id)); card.append(link); }
      if (!item.opened_at) card.addEventListener('click', () => markOpened(item.id), { once: true });
      root.append(card);
    });
  } catch (error) { message('teacher-message', error.message); }
}
async function markOpened(submissionId) {
  if (state.seen.has(submissionId)) return;
  state.seen.add(submissionId);
  try { await api('/api/teacher/sessions/' + state.id + '/submissions/' + submissionId + '/open', { method: 'POST', headers: { 'x-teacher-token': state.token } }); await refreshSubmissions(); }
  catch (error) { message('teacher-message', error.message); }
}
$('refresh-submissions').addEventListener('click', refreshSubmissions);
$('close-session').addEventListener('click', async () => {
  if (!state.id || !confirm('Close this session? Students will no longer be able to submit work.')) return;
  try {
    await api('/api/teacher/sessions/' + state.id + '/close', { method: 'POST', headers: { 'x-teacher-token': state.token } });
    if (state.timer) clearInterval(state.timer);
    $('close-session').disabled = true; $('close-session').textContent = 'Session closed';
    $('session-pin').textContent = 'CLOSED';
    message('teacher-message', 'Session closed.');
  } catch (error) { message('teacher-message', error.message); }
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
