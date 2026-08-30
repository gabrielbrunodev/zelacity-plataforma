const zlib = require('node:zlib');

const categoryLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };
const statusLabels = { RECEBIDA: 'Recebida', AGUARDANDO_ANALISE: 'Aguardando análise', EM_ANALISE: 'Em análise', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas', APROVADA: 'Aprovada', PROGRAMADA: 'Programada', EM_EXECUCAO: 'Em execução', CONCLUIDA: 'Concluída', INDEFERIDA: 'Indeferida', CANCELADA: 'Cancelada' };
const workOrderStatusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', EXECUTADA: 'Executada', PENDENCIA_IDENTIFICADA: 'Pendência identificada', CONFERENCIA: 'Conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value));
}

function formatPeriod(period) {
  if (!period) return 'Sem período';
  const [year, month] = period.split('-');
  return `${month}/${year}`;
}

function formatHours(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const minutes = Math.round(Number(value) * 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return `${days ? `${days}d ` : ''}${hours}h ${remainingMinutes}min`;
}

function filterDescription(filters) {
  const parts = [];
  if (filters.startDate || filters.endDate) parts.push(`Período: ${filters.startDate ? formatDate(`${filters.startDate}T12:00:00Z`) : 'início'} a ${filters.endDate ? formatDate(`${filters.endDate}T12:00:00Z`) : 'hoje'}`);
  if (filters.category) parts.push(`Categoria: ${categoryLabels[filters.category] || filters.category}`);
  if (filters.status) parts.push(`Status: ${statusLabels[filters.status] || filters.status}`);
  if (filters.neighborhood) parts.push(`Bairro: ${filters.neighborhood}`);
  return parts.length ? parts.join(' · ') : 'Todos os registros';
}

function reportSheets(report) {
  const metadata = [['Relatório administrativo — Zelacity Plataforma'], ['Gerado em', formatDate(report.generatedAt, true)], ['Filtros', filterDescription(report.filters)]];
  return [
    {
      name: 'Resumo',
      rows: [...metadata, [], ['Indicador', 'Quantidade'], ['Total de solicitações', report.summary.total_requests], ['Solicitações concluídas', report.summary.completed_requests], ['Solicitações pendentes', report.summary.pending_requests], ['Tempo médio de atendimento', formatHours(report.summary.average_attendance_hours)]],
    },
    {
      name: 'Por período',
      rows: [...metadata, [], ['Período', 'Total', 'Concluídas', 'Pendentes'], ...report.byPeriod.map((item) => [formatPeriod(item.period), item.total, item.completed, item.pending])],
    },
    {
      name: 'Por categoria',
      rows: [...metadata, [], ['Categoria', 'Total', 'Concluídas', 'Pendentes'], ...report.byCategory.map((item) => [categoryLabels[item.category] || item.category, item.total, item.completed, item.pending])],
    },
    {
      name: 'Por bairro',
      rows: [...metadata, [], ['Bairro', 'Total', 'Concluídas', 'Pendentes'], ...report.byNeighborhood.map((item) => [item.neighborhood, item.total, item.completed, item.pending])],
    },
    {
      name: 'Por equipe',
      rows: [...metadata, [], ['Equipe', 'Serviços executados'], ...report.servicesByTeam.map((item) => [item.team, item.executed_services])],
    },
    {
      name: 'Solicitações',
      rows: [...metadata, [], ['Protocolo', 'Data', 'Categoria', 'Local', 'Bairro', 'Status', 'Prioridade', 'OS', 'Status da OS', 'Equipe', 'Concluída em', 'Tempo de atendimento'], ...report.requests.map((item) => [item.protocol, formatDate(item.created_at, true), categoryLabels[item.category] || item.category, item.location, item.neighborhood, statusLabels[item.status] || item.status, priorityLabels[item.priority] || item.priority, item.work_order_number || '—', workOrderStatusLabels[item.work_order_status] || item.work_order_status || '—', item.team || '—', formatDate(item.completed_at, true), formatHours(item.attendance_hours)])],
    },
  ];
}

function escapeCsv(value) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

function createCsv(report) {
  const sheets = reportSheets(report);
  return `\uFEFF${sheets.flatMap((sheet, index) => [
    [sheet.name],
    ...sheet.rows,
    ...(index < sheets.length - 1 ? [[]] : []),
  ]).map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((year - 1980) << 9),
  };
}

function createZip(entries) {
  const now = dosDateTime(new Date());
  const localFiles = [];
  const centralFiles = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const compressed = zlib.deflateRawSync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localFiles.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralFiles.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralFiles);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localFiles, centralDirectory, end]);
}

function createXlsx(report) {
  const sheets = reportSheets(report);
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>' },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet.rows) })),
  ];
  return createZip(entries);
}

module.exports = { createCsv, createXlsx };
