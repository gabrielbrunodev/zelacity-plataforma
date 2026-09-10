const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const profile = new URLSearchParams(window.location.search).get('perfil');
const profiles = {
  FUNCIONARIO: { role: 'MANUTENCAO', label: 'Acesso do funcionário', copy: 'Entre com seu usuário para consultar e executar as ordens atribuídas à sua equipe.' },
  ADMINISTRADOR: { role: 'ADMINISTRADOR', label: 'Acesso da administração', copy: 'Entre com seu usuário para gerenciar solicitações, equipes e relatórios.' },
  VEREADOR: { role: 'VEREADOR', label: 'Acesso do vereador', copy: 'Entre para registrar demandas e acompanhar os protocolos do seu gabinete.' },
};
const selectedProfile = profiles[profile];

if (selectedProfile) {
  document.querySelector('#login-profile-label').textContent = selectedProfile.label;
  document.querySelector('#login-title').textContent = 'Identifique-se para continuar';
  document.querySelector('#login-copy').textContent = selectedProfile.copy;
}

fetch('/api/auth/me').then(async (response) => {
  if (response.ok) {
    const { user } = await response.json();
    window.location.replace(user.role === 'MANUTENCAO' ? '/manutencao.html' : user.role === 'VEREADOR' ? '/vereador.html' : '/painel.html');
  }
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
    if (selectedProfile && result.user.role !== selectedProfile.role) {
      await fetch('/api/auth/logout', { method: 'POST' });
      throw new Error(`Este acesso é destinado ao perfil: ${selectedProfile.label.toLowerCase()}.`);
    }
    window.location.assign(result.user.role === 'MANUTENCAO' ? '/manutencao.html' : result.user.role === 'VEREADOR' ? '/vereador.html' : '/painel.html');
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally { button.disabled = false; }
});
