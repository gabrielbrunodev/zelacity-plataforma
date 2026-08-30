const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');

fetch('/api/auth/me').then((response) => {
  if (response.ok) window.location.replace('/painel.html');
}).catch(() => {});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  if (!loginForm.checkValidity()) { loginForm.reportValidity(); return; }
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(loginForm))) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
    window.location.assign('/painel.html');
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally { button.disabled = false; }
});
