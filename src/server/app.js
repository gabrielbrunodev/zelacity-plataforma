const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');
const { createCsv, createXlsx } = require('./reportExporter');
const { DEMO_PASSWORD } = require('./demoData');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jfif': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const PROTECTED_PAGES = new Map([
  ['/painel.html', ['ADMINISTRADOR']],
  ['/ordens-servico.html', ['ADMINISTRADOR', 'MANUTENCAO']],
  ['/relatorios.html', ['ADMINISTRADOR']],
  ['/manutencao.html', ['MANUTENCAO']],
  ['/vereador.html', ['VEREADOR']],
]);

const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.google.com https://*.gstatic.com; connect-src 'self' https://maps.googleapis.com; frame-src https://www.google.com https://*.google.com;",
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function sendDownload(response, content, filename, contentType) {
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('O conteúdo enviado é muito grande.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Dados inválidos.'));
      }
    });
    request.on('error', reject);
  });
}

function readMultipartBody(request) {
  const contentType = request.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) return Promise.reject(new Error('Envie os dados de finalização em formato multipart.'));
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error('O envio de fotos excede o limite de 12 MB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const source = Buffer.concat(chunks).toString('latin1');
        const sections = source.split(`--${boundary}`);
        const fields = {};
        const files = {};
        for (const section of sections) {
          if (!section || section === '--\r\n' || section === '--') continue;
          const normalized = section.startsWith('\r\n') ? section.slice(2) : section;
          const separator = normalized.indexOf('\r\n\r\n');
          if (separator < 0) continue;
          const headers = normalized.slice(0, separator);
          let content = normalized.slice(separator + 4);
          if (content.endsWith('\r\n')) content = content.slice(0, -2);
          const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (!disposition) continue;
          const [, name, filename] = disposition;
          if (filename !== undefined) {
            const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || '';
            if (filename) files[name] = { filename, contentType: mimeType, data: Buffer.from(content, 'latin1') };
          } else {
            fields[name] = Buffer.from(content, 'latin1').toString('utf8');
          }
        }
        resolve({ fields, files });
      } catch {
        reject(new Error('Não foi possível processar o envio de fotos.'));
      }
    });
    request.on('error', reject);
  });
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))];
  }).filter(([name]) => name));
}

function sessionCookie(token, request) {
  const maxAge = config.sessionHours * 60 * 60;
  const isMobileOrigin = config.mobileAllowedOrigins.has(request.headers.origin);
  const sameSite = isMobileOrigin ? 'None' : 'Strict';
  const secure = config.secureCookies || isMobileOrigin;
  return `munimanutencao_session=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function expiredSessionCookie(request) {
  const isMobileOrigin = config.mobileAllowedOrigins.has(request.headers.origin);
  const sameSite = isMobileOrigin ? 'None' : 'Strict';
  const secure = config.secureCookies || isMobileOrigin;
  return `munimanutencao_session=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function getAuthenticatedUser(request, authService) {
  return authService.getUserFromToken(parseCookies(request).munimanutencao_session);
}

function requireRoles(request, response, authService, roles) {
  const user = getAuthenticatedUser(request, authService);
  if (!user) {
    sendJson(response, 401, { error: 'Autenticação necessária.' });
    return null;
  }
  if (!roles.includes(user.role)) {
    sendJson(response, 403, { error: 'Você não tem permissão para esta ação.' });
    return null;
  }
  return user;
}

function hasAllowedOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  return !origin || origin === `http://${host}` || origin === `https://${host}` || config.mobileAllowedOrigins.has(origin);
}

function isNativeAssetRequest(request) {
  const host = String(request.headers.host || '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || request.headers.origin === 'https://localhost';
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!config.mobileAllowedOrigins.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    Vary: 'Origin',
  };
}

function isPathInside(baseDirectory, targetPath) {
  const relativePath = path.relative(baseDirectory, targetPath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

function serveStaticFile(request, response) {
  const requestPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const safePath = path.normalize(requestPath).replace(/^([.][.][\\/])+/, '');
  const filePath = path.join(config.publicDirectory, safePath);

  if (!isPathInside(config.publicDirectory, filePath)) {
    sendJson(response, 403, { error: 'Acesso não permitido.' });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        sendJson(response, 404, { error: 'Recurso não encontrado.' });
        return;
      }
      sendJson(response, 500, { error: 'Não foi possível carregar o recurso.' });
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream' });
    response.end(content);
  });
}

function canViewImage(user, image) {
  if (user.role === 'ADMINISTRADOR') return true;
  if (['SOLICITANTE', 'VEREADOR'].includes(user.role)) return image.requester_user_id === user.id;
  return user.role === 'MANUTENCAO' && image.team_id === user.teamId && (!image.assigned_user_id || image.assigned_user_id === user.id);
}

function serveStoredImage(response, image) {
  const filename = path.basename(image.storage_path);
  const filePath = path.join(config.uploadDirectory, filename);
  if (!isPathInside(config.uploadDirectory, filePath)) {
    sendJson(response, 403, { error: 'Acesso não permitido.' });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Imagem não encontrada.' : 'Não foi possível carregar a imagem.' });
      return;
    }
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': image.mime_type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  });
}

function createApp({ requestService, workOrderService, reportService, authService, imageRepository, auditRepository, categoryService, internalNotificationService } = {}) {
  if (!requestService || !workOrderService || !reportService || !authService || !imageRepository || !auditRepository || !categoryService || !internalNotificationService) throw new Error('Os serviços da aplicação são obrigatórios.');

  return async (request, response) => {
    const allowedCorsHeaders = corsHeaders(request);
    Object.entries(allowedCorsHeaders).forEach(([name, value]) => response.setHeader(name, value));
    if (request.method === 'OPTIONS') {
      if (!Object.keys(allowedCorsHeaders).length) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      response.writeHead(204, SECURITY_HEADERS);
      response.end();
      return;
    }
    const requestUrl = new URL(request.url, 'http://localhost');
    const { pathname } = requestUrl;

    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', service: 'Zelacity Plataforma API' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/config/maps') {
      // Chaves do Maps JavaScript API são usadas pelo navegador. Elas devem ser
      // restringidas por domínio e por API no Google Cloud, nunca tratadas como segredo.
      sendJson(response, 200, {
        enabled: Boolean(config.googleMapsApiKey),
        apiKey: config.googleMapsApiKey || null,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/config/demo') {
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      sendJson(response, 200, {
        enabled: config.demoMode,
        username: config.demoMode ? 'admin@zelacity.teste' : null,
        password: config.demoMode ? DEMO_PASSWORD : null,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/categories') {
      sendJson(response, 200, { categories: categoryService.listPublic() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      try {
        const { username, email, password } = await readJsonBody(request);
        const result = authService.authenticate(username || email, password);
        if (result.error) { sendJson(response, 401, { error: result.error }); return; }
        sendJson(response, 200, { user: result.user }, { 'Set-Cookie': sessionCookie(result.token, request) });
      } catch {
        sendJson(response, 400, { error: 'Não foi possível iniciar a sessão.' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      authService.logout(parseCookies(request).munimanutencao_session);
      sendJson(response, 200, { message: 'Sessão encerrada.' }, { 'Set-Cookie': expiredSessionCookie(request) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      const user = getAuthenticatedUser(request, authService);
      if (!user) { sendJson(response, 401, { error: 'Autenticação necessária.' }); return; }
      sendJson(response, 200, { user });
      return;
    }

    const imageMatch = pathname.match(/^\/api\/images\/(\d+)$/);
    if (request.method === 'GET' && imageMatch) {
      const user = getAuthenticatedUser(request, authService);
      if (!user) { sendJson(response, 401, { error: 'Autenticação necessária.' }); return; }
      const image = imageRepository.findById(Number(imageMatch[1]));
      if (!image) { sendJson(response, 404, { error: 'Imagem não encontrada.' }); return; }
      if (!canViewImage(user, image)) { sendJson(response, 403, { error: 'Você não tem permissão para visualizar esta imagem.' }); return; }
      serveStoredImage(response, image);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/users') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      sendJson(response, 200, { users: authService.listUsers() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/users') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = authService.createUser(await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        sendJson(response, 201, { user: result.user });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível criar o usuário.' });
      }
      return;
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (request.method === 'PATCH' && userMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = authService.updateUser(Number(userMatch[1]), await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Funcionário não encontrado.' }); return; }
        sendJson(response, 200, { user: result.user });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível atualizar o funcionário.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/teams') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      sendJson(response, 200, { teams: workOrderService.listTeams() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/teams') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = workOrderService.createTeam((await readJsonBody(request)).name);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        sendJson(response, 201, result);
      } catch {
        sendJson(response, 500, { error: 'Não foi possível criar a equipe.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/notifications') {
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      sendJson(response, 200, internalNotificationService.listForUser(user.id));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/notifications/read-all') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      internalNotificationService.markAllRead(user.id);
      sendJson(response, 200, { success: true });
      return;
    }

    const notificationMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (request.method === 'PATCH' && notificationMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      if (!internalNotificationService.markRead(notificationMatch[1], user.id)) { sendJson(response, 404, { error: 'Notificação não encontrada.' }); return; }
      sendJson(response, 200, { success: true });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/categories') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      sendJson(response, 200, { categories: categoryService.listManagement() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/categories') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = categoryService.create(await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        sendJson(response, 201, result);
      } catch {
        sendJson(response, 500, { error: 'Não foi possível criar a categoria.' });
      }
      return;
    }

    const categoryMatch = pathname.match(/^\/api\/admin\/categories\/([A-Z0-9_]+)$/);
    if (request.method === 'PATCH' && categoryMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = categoryService.update(categoryMatch[1], await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Categoria não encontrada.' }); return; }
        sendJson(response, 200, result);
      } catch {
        sendJson(response, 500, { error: 'Não foi possível atualizar a categoria.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/requests') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      sendJson(response, 200, { requests: requestService.listAll() });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/vereador/requests') {
      const user = requireRoles(request, response, authService, ['VEREADOR']);
      if (!user) return;
      sendJson(response, 200, { requests: requestService.listForCouncilMember(user.id) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/dashboard') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      const filters = {
        category: requestUrl.searchParams.get('category') || '',
        status: requestUrl.searchParams.get('status') || '',
        priority: requestUrl.searchParams.get('priority') || '',
        startDate: requestUrl.searchParams.get('startDate') || '',
        endDate: requestUrl.searchParams.get('endDate') || '',
        neighborhood: requestUrl.searchParams.get('neighborhood') || '',
        protocol: requestUrl.searchParams.get('protocol') || '',
        source: requestUrl.searchParams.get('source') || '',
        teamId: requestUrl.searchParams.get('teamId') || '',
        employeeId: requestUrl.searchParams.get('employeeId') || '',
      };
      sendJson(response, 200, requestService.getAdministratorDashboard(filters));
      return;
    }

    if (request.method === 'GET' && ['/api/admin/reports', '/api/admin/reports/export.csv', '/api/admin/reports/export.xlsx'].includes(pathname)) {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      try {
        const result = reportService.getAdministratorReport({
          startDate: requestUrl.searchParams.get('startDate') || '',
          endDate: requestUrl.searchParams.get('endDate') || '',
          category: requestUrl.searchParams.get('category') || '',
          status: requestUrl.searchParams.get('status') || '',
          source: requestUrl.searchParams.get('source') || '',
          neighborhood: requestUrl.searchParams.get('neighborhood') || '',
          priority: requestUrl.searchParams.get('priority') || '',
          teamId: requestUrl.searchParams.get('teamId') || '',
          employeeId: requestUrl.searchParams.get('employeeId') || '',
        });
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (pathname === '/api/admin/reports') { sendJson(response, 200, result); return; }
        const stamp = new Date().toISOString().slice(0, 10);
        if (pathname.endsWith('.csv')) {
          sendDownload(response, createCsv(result), `relatorio-munimanutencao-${stamp}.csv`, 'text/csv; charset=utf-8');
        } else {
          sendDownload(response, createXlsx(result), `relatorio-munimanutencao-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }
      } catch {
        sendJson(response, 500, { error: 'Não foi possível gerar o relatório.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/map-requests') {
      if (!requireRoles(request, response, authService, ['ADMINISTRADOR'])) return;
      const result = requestService.getAdministratorMap({
        category: requestUrl.searchParams.get('category') || '',
        status: requestUrl.searchParams.get('status') || '',
      });
      if (result.error) { sendJson(response, 400, { error: result.error }); return; }
      sendJson(response, 200, result);
      return;
    }

    const publicProtocolMatch = pathname.match(/^\/api\/public\/requests\/([^/]+)$/);
    if (request.method === 'GET' && publicProtocolMatch) {
      const result = requestService.findPublicByProtocol(decodeURIComponent(publicProtocolMatch[1]));
      if (result.error) { sendJson(response, 400, { error: result.error }); return; }
      if (result.notFound) { sendJson(response, 404, { error: 'Protocolo não encontrado. Verifique o número informado.' }); return; }
      sendJson(response, 200, { request: result.request });
      return;
    }

    const protocolMatch = pathname.match(/^\/api\/requests\/([^/]+)$/);
    if (request.method === 'GET' && protocolMatch) {
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      const result = requestService.findByProtocol(decodeURIComponent(protocolMatch[1]));
      if (result.error) { sendJson(response, 400, { error: result.error }); return; }
      if (result.notFound) { sendJson(response, 404, { error: 'Solicitação não encontrada.' }); return; }
      result.request.images = imageRepository.listForRequest(result.request.id);
      result.request.history = auditRepository.listForRequest(result.request.id);
      sendJson(response, 200, { request: result.request });
      return;
    }

    if (request.method === 'PATCH' && protocolMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      try {
        const result = requestService.updateManagement(decodeURIComponent(protocolMatch[1]), await readJsonBody(request), user.id);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Solicitação não encontrada.' }); return; }
        sendJson(response, 200, { request: result.request });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível atualizar a solicitação.' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/requests') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      try {
        let payload;
        let requestPhoto;
        if ((request.headers['content-type'] || '').startsWith('multipart/form-data')) {
          const { fields, files } = await readMultipartBody(request);
          payload = fields;
          requestPhoto = files.requestPhoto;
        } else {
          payload = await readJsonBody(request);
        }
        const result = requestService.createManual(payload, user, requestPhoto);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        sendJson(response, 201, { message: 'Solicitação manual registrada com sucesso.', protocol: result.request.protocol, request: result.request });
      } catch (error) {
        sendJson(response, 400, { error: error.message || 'Não foi possível registrar a solicitação manual.' });
      }
      return;
    }

    const workOrderCreateMatch = pathname.match(/^\/api\/requests\/([^/]+)\/work-orders$/);
    if (request.method === 'POST' && workOrderCreateMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      try {
        const result = workOrderService.create(decodeURIComponent(workOrderCreateMatch[1]), await readJsonBody(request), user.id);
        if (result.error || result.teamNotFound || result.assigneeNotFound || result.assigneeCategoryMismatch) { sendJson(response, 400, { error: result.error || (result.assigneeCategoryMismatch ? 'O responsável selecionado não está habilitado para esta categoria.' : 'Equipe ou responsável não encontrado.') }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Solicitação não encontrada.' }); return; }
        sendJson(response, 201, { workOrder: result.workOrder });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível criar a ordem de serviço.' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/requests') {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      try {
        let payload;
        let requestPhoto;
        if ((request.headers['content-type'] || '').startsWith('multipart/form-data')) {
          const { fields, files } = await readMultipartBody(request);
          let specificDetails = {};
          try { specificDetails = fields.specificDetails ? JSON.parse(fields.specificDetails) : {}; } catch { throw new Error('Dados específicos da solicitação inválidos.'); }
          payload = { ...fields, specificDetails };
          requestPhoto = files.requestPhoto;
        } else {
          payload = await readJsonBody(request);
        }
        const authenticatedUser = getAuthenticatedUser(request, authService);
        const requesterUser = authenticatedUser?.role === 'VEREADOR' ? authenticatedUser : null;
        const result = requestService.register(payload, requesterUser, requestPhoto);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        sendJson(response, 201, { message: 'Solicitação registrada com sucesso', protocol: result.request.protocol, createdAt: result.request.createdAt, notifications: result.notifications });
      } catch (error) {
        sendJson(response, 400, { error: error.message || 'Não foi possível registrar a solicitação.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/work-orders') {
      const user = requireRoles(request, response, authService, ['MANUTENCAO', 'ADMINISTRADOR']);
      if (!user) return;
      sendJson(response, 200, { workOrders: workOrderService.listForUser(user) });
      return;
    }

    const workOrderNumberMatch = pathname.match(/^\/api\/work-orders\/([^/]+)$/);
    if (request.method === 'GET' && workOrderNumberMatch) {
      const user = requireRoles(request, response, authService, ['MANUTENCAO', 'ADMINISTRADOR']);
      if (!user) return;
      const result = workOrderService.findByNumber(decodeURIComponent(workOrderNumberMatch[1]), user);
      if (result.error) { sendJson(response, 400, { error: result.error }); return; }
      if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
      if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
      result.workOrder.images = imageRepository.listForRequest(result.workOrder.request_id);
      result.workOrder.history = auditRepository.listForWorkOrder(result.workOrder.id);
      sendJson(response, 200, { workOrder: result.workOrder });
      return;
    }

    if (request.method === 'PATCH' && workOrderNumberMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      try {
        const result = workOrderService.updateManagement(decodeURIComponent(workOrderNumberMatch[1]), await readJsonBody(request), user.id);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 200, { workOrder: result.workOrder });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível atualizar a ordem de serviço.' });
      }
      return;
    }

    const workOrderUpdateMatch = pathname.match(/^\/api\/work-orders\/(\d+)\/updates$/);
    if (request.method === 'POST' && workOrderUpdateMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      try {
        const result = workOrderService.registerUpdate(workOrderUpdateMatch[1], user, await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 201, { workOrder: result.workOrder });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível registrar a atualização.' });
      }
      return;
    }

    const workOrderStartMatch = pathname.match(/^\/api\/work-orders\/(\d+)\/start$/);
    if (request.method === 'POST' && workOrderStartMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      try {
        const result = workOrderService.start(workOrderStartMatch[1], user);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 200, { workOrder: result.workOrder });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível iniciar o serviço.' });
      }
      return;
    }

    const workOrderNotificationMatch = pathname.match(/^\/api\/work-orders\/([^/]+)\/notifications$/);
    if (request.method === 'POST' && workOrderNotificationMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['ADMINISTRADOR']);
      if (!user) return;
      try {
        const result = workOrderService.sendAdministrativeMessage(decodeURIComponent(workOrderNotificationMatch[1]), user.id, (await readJsonBody(request)).message);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 201, { success: true });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível enviar a mensagem administrativa.' });
      }
      return;
    }

    const workOrderPhotoMatch = pathname.match(/^\/api\/work-orders\/(\d+)\/photos$/);
    if (request.method === 'POST' && workOrderPhotoMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      try {
        const { files } = await readMultipartBody(request);
        const result = workOrderService.addPhoto(workOrderPhotoMatch[1], user, files.photo);
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 201, { workOrder: result.workOrder, image: result.image });
      } catch (error) {
        sendJson(response, 400, { error: error.message || 'Não foi possível adicionar a foto.' });
      }
      return;
    }

    const workOrderCompleteMatch = pathname.match(/^\/api\/work-orders\/(\d+)\/complete$/);
    if (request.method === 'POST' && workOrderCompleteMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      try {
        const { fields, files } = await readMultipartBody(request);
        const result = workOrderService.complete(workOrderCompleteMatch[1], user, {
          observation: fields.observation,
          materialsUsed: fields.materialsUsed,
          beforePhoto: files.beforePhoto,
          afterPhoto: files.afterPhoto,
          latitude: fields.latitude,
          longitude: fields.longitude,
        });
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 201, { workOrder: result.workOrder });
      } catch (error) {
        sendJson(response, 400, { error: error.message || 'Não foi possível finalizar o serviço.' });
      }
      return;
    }

    const workOrderPendingMatch = pathname.match(/^\/api\/work-orders\/(\d+)\/pending$/);
    if (request.method === 'POST' && workOrderPendingMatch) {
      if (!hasAllowedOrigin(request)) { sendJson(response, 403, { error: 'Origem não permitida.' }); return; }
      const user = requireRoles(request, response, authService, ['MANUTENCAO']);
      if (!user) return;
      try {
        const result = workOrderService.reportPending(workOrderPendingMatch[1], user, await readJsonBody(request));
        if (result.error) { sendJson(response, 400, { error: result.error }); return; }
        if (result.forbidden) { sendJson(response, 403, { error: 'A ordem de serviço não pertence à sua equipe.' }); return; }
        if (result.notFound) { sendJson(response, 404, { error: 'Ordem de serviço não encontrada.' }); return; }
        sendJson(response, 201, { workOrder: result.workOrder });
      } catch {
        sendJson(response, 500, { error: 'Não foi possível registrar a pendência.' });
      }
      return;
    }

    if (request.method === 'GET') {
      const allowedRoles = PROTECTED_PAGES.get(pathname);
      // No APK, as páginas HTML são empacotadas localmente em https://localhost.
      // A autenticação continua sendo exigida pelas APIs remotas; apenas o
      // carregamento do shell local não deve redirecionar a sessão para o login.
      if (allowedRoles && !isNativeAssetRequest(request)) {
        const user = getAuthenticatedUser(request, authService);
        if (!user) {
          response.writeHead(302, { ...SECURITY_HEADERS, Location: '/login.html' });
          response.end();
          return;
        }
        if (!allowedRoles.includes(user.role)) {
          const destination = user.role === 'VEREADOR' ? '/vereador.html' : user.role === 'MANUTENCAO' ? '/manutencao.html' : '/';
          response.writeHead(302, { ...SECURITY_HEADERS, Location: destination });
          response.end();
          return;
        }
      }
      serveStaticFile(request, response);
      return;
    }
    sendJson(response, 405, { error: 'Método não permitido.' });
  };
}

module.exports = { createApp };
