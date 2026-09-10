const requestForm = document.querySelector('#request-form');
const serviceType = document.querySelector('#service-type');
const formError = document.querySelector('#form-error');
const confirmation = document.querySelector('#confirmation');
const formCard = document.querySelector('#request-form-card');
const protocolNumber = document.querySelector('#protocol-number');
const confirmationMessage = document.querySelector('#confirmation-message');
const confirmationActions = document.querySelector('#confirmation-actions');
const submitButton = requestForm.querySelector('[type="submit"]');
const requestLocationButton = document.querySelector('#request-location-button');
const requestLocationFeedback = document.querySelector('#request-location-feedback');
const requestLatitude = document.querySelector('#request-latitude');
const requestLongitude = document.querySelector('#request-longitude');
const requestLocationField = document.querySelector('[name="location"]');
const requestNeighborhoodField = document.querySelector('[name="neighborhood"]');
const requestMapButton = document.querySelector('#request-map-button');
const requestMapWrapper = document.querySelector('#request-map-wrapper');
const requestMapEmbed = document.querySelector('#request-map-embed');
const requestMapElement = document.querySelector('#request-map');
const navActions = document.querySelector('#nav-actions');
const councilFormNote = document.querySelector('#council-form-note');

let requestMap = null;
let requestMarker = null;
let requestGeocoder = null;
let googleMapsLoader = null;
let currentUser = null;

const roleLabels = { VEREADOR: 'Vereador', MANUTENCAO: 'Manutenção', ADMINISTRADOR: 'Administração' };

async function loadActiveCategories() {
  try {
    const response = await fetch('/api/categories');
    const { categories } = await response.json();
    if (!response.ok || !Array.isArray(categories)) return;
    const selected = serviceType.value;
    serviceType.replaceChildren(new Option('Selecione o serviço', ''));
    categories.forEach((category) => serviceType.add(new Option(category.name, category.code)));
    serviceType.value = selected;
  } catch {
    // Mantém as opções iniciais caso a configuração não esteja disponível.
  }
}

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) return;
    const { user } = await response.json();
    currentUser = user;
    if (user.role === 'VEREADOR') {
      const nameInput = requestForm.elements.name;
      nameInput.value = user.name;
      nameInput.readOnly = true;
      councilFormNote.hidden = false;
    }
    navActions.replaceChildren();
    const howItWorks = document.createElement('a');
    howItWorks.className = 'nav-link'; howItWorks.href = '#como-funciona'; howItWorks.textContent = 'Como funciona';
    const userChip = document.createElement('a');
    userChip.className = 'user-chip';
    userChip.href = user.role === 'MANUTENCAO' ? '/manutencao.html' : '/painel.html';
    userChip.textContent = `${roleLabels[user.role] || 'Área interna'} · ${user.name}`;
    const logout = document.createElement('button');
    logout.className = 'nav-logout'; logout.type = 'button'; logout.textContent = 'Sair';
    logout.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); });
    navActions.append(howItWorks, userChip, logout);
  } catch {
    // A área pública funciona mesmo sem sessão.
  }
}

function showError(message) { formError.textContent = message; formError.hidden = false; }
function clearError() { formError.hidden = true; formError.textContent = ''; }

function setRequestCoordinates(latitude, longitude, message) {
  requestLatitude.value = Number(latitude).toFixed(6);
  requestLongitude.value = Number(longitude).toFixed(6);
  requestLocationFeedback.textContent = message;
  if (!requestMap || !window.google?.maps) return;
  const position = { lat: Number(latitude), lng: Number(longitude) };
  if (requestMarker) requestMarker.setPosition(position);
  else requestMarker = new window.google.maps.Marker({ map: requestMap, position });
  requestMap.panTo(position); requestMap.setZoom(17);
}

function findAddressComponent(components, types) {
  return components.find((item) => types.some((type) => item.types.includes(type)))?.long_name || '';
}

async function fillAddressFromMap(latitude, longitude) {
  if (!requestGeocoder) return;
  requestLocationFeedback.textContent = 'Ponto selecionado. Buscando rua e bairro…';
  try {
    const response = await requestGeocoder.geocode({ location: { lat: latitude, lng: longitude } });
    const components = response.results?.[0]?.address_components || [];
    const street = findAddressComponent(components, ['route']);
    const number = findAddressComponent(components, ['street_number']);
    const neighborhood = findAddressComponent(components, ['sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_4']);
    if (street) requestLocationField.value = number ? `${street}, ${number}` : street;
    if (neighborhood) requestNeighborhoodField.value = neighborhood;
    requestLocationFeedback.textContent = street || neighborhood
      ? 'Rua e bairro preenchidos automaticamente. Revise os dados antes de enviar.'
      : 'Não foi possível identificar rua e bairro. Preencha-os manualmente.';
  } catch {
    requestLocationFeedback.textContent = 'Não foi possível identificar rua e bairro. Preencha-os manualmente.';
  }
}

function captureLocation() {
  if (!navigator.geolocation) { requestLocationFeedback.textContent = 'A localização não está disponível neste dispositivo. Informe o endereço manualmente ou use o mapa.'; return; }
  requestLocationButton.disabled = true; requestLocationFeedback.textContent = 'Obtendo sua localização…';
  navigator.geolocation.getCurrentPosition(
    (position) => { setRequestCoordinates(position.coords.latitude, position.coords.longitude, 'Localização atual compartilhada com sucesso.'); requestLocationButton.disabled = false; },
    () => { requestLocationFeedback.textContent = 'A localização não foi compartilhada. Você pode continuar informando o endereço manualmente ou usar o mapa.'; requestLocationButton.disabled = false; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

async function loadGoogleMaps() {
  if (window.google?.maps) return window.google.maps;
  if (googleMapsLoader) return googleMapsLoader;
  googleMapsLoader = (async () => {
    const response = await fetch('/api/config/maps');
    const mapsConfig = await response.json();
    if (!response.ok || !mapsConfig.enabled || !mapsConfig.apiKey) throw new Error('O mapa ainda não está configurado. Informe a chave do Google Maps no servidor.');
    await new Promise((resolve, reject) => {
      const callbackName = `zelacityMapsReady${Date.now()}`;
      window[callbackName] = () => { delete window[callbackName]; resolve(); };
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsConfig.apiKey)}&v=weekly&loading=async&callback=${callbackName}&auth_referrer_policy=origin`;
      script.onerror = () => { delete window[callbackName]; reject(new Error('Não foi possível carregar o Google Maps. Verifique sua conexão e a configuração da chave.')); };
      document.head.append(script);
    });
    return window.google.maps;
  })();
  try { return await googleMapsLoader; } catch (error) { googleMapsLoader = null; throw error; }
}

function createRequestMap() {
  if (requestMap) return;
  const maps = window.google.maps;
  requestMap = new maps.Map(requestMapElement, { center: { lat: -14.235004, lng: -51.92528 }, zoom: 4, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
  requestGeocoder = new maps.Geocoder();
  requestMap.addListener('click', async (event) => {
    if (!event.latLng) return;
    const latitude = event.latLng.lat(); const longitude = event.latLng.lng();
    setRequestCoordinates(latitude, longitude, 'Ponto selecionado no mapa.');
    await fillAddressFromMap(latitude, longitude);
  });
  if (requestLatitude.value && requestLongitude.value) setRequestCoordinates(requestLatitude.value, requestLongitude.value, 'Localização já selecionada.');
}

async function openRequestMap() {
  requestMapButton.disabled = true; requestLocationFeedback.textContent = 'Carregando o mapa…';
  try {
    await loadGoogleMaps(); requestMapWrapper.hidden = false; requestMapEmbed.hidden = true; requestMapElement.hidden = false; createRequestMap();
    requestMapButton.textContent = 'Mapa aberto';
    requestLocationFeedback.textContent = requestLatitude.value ? 'Clique no mapa para ajustar o ponto selecionado.' : 'Clique no mapa para marcar a localização da solicitação.';
    requestMapElement.focus({ preventScroll: true });
  } catch (error) { requestLocationFeedback.textContent = error.message; }
  finally { requestMapButton.disabled = false; }
}

async function copyProtocol(protocol, feedback) {
  try {
    await navigator.clipboard.writeText(protocol);
    feedback.textContent = 'Protocolo copiado.';
  } catch {
    const input = document.createElement('textarea'); input.value = protocol; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
    feedback.textContent = 'Protocolo copiado.';
  }
}

function renderConfirmation(protocol) {
  protocolNumber.textContent = protocol;
  confirmationMessage.textContent = 'Guarde este número para acompanhar sua solicitação.';
  confirmationActions.replaceChildren();
  const copy = document.createElement('button'); copy.className = 'button button-secondary button-small'; copy.type = 'button'; copy.textContent = 'Copiar protocolo';
  const tracking = document.createElement('a'); tracking.className = 'button button-primary button-small'; tracking.href = `/acompanhar.html?protocol=${encodeURIComponent(protocol)}`; tracking.textContent = 'Acompanhar solicitação';
  const home = document.createElement('a'); home.className = 'button button-secondary button-small'; home.href = '/'; home.textContent = 'Voltar ao início';
  const feedback = document.createElement('p'); feedback.className = 'inline-feedback'; feedback.setAttribute('aria-live', 'polite');
  copy.addEventListener('click', () => copyProtocol(protocol, feedback));
  confirmationActions.append(copy, tracking, home, feedback);
}

document.querySelectorAll('[data-service]').forEach((card) => card.addEventListener('click', () => { serviceType.value = card.dataset.service; }));
requestForm.addEventListener('submit', async (event) => {
  event.preventDefault(); clearError();
  if (!requestForm.checkValidity()) { requestForm.reportValidity(); return; }
  const formData = new FormData(requestForm); formData.set('specificDetails', '{}');
  submitButton.disabled = true; submitButton.textContent = 'Registrando...';
  try {
    const response = await fetch('/api/requests', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a solicitação.');
    renderConfirmation(result.protocol); requestForm.hidden = true; confirmation.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { showError(error.message); }
  finally { submitButton.disabled = false; submitButton.innerHTML = 'Registrar solicitação <span aria-hidden="true">→</span>'; }
});
requestLocationButton.addEventListener('click', captureLocation);
requestMapButton.addEventListener('click', openRequestMap);
loadCurrentUser();
loadActiveCategories();
