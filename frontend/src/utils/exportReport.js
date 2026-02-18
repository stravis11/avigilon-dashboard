/**
 * Camera Statistics export utilities — CSV and PDF
 *
 * Both functions accept the same data bag:
 *   { cameras, filteredCount, offlineCount, mfrBreakdown, servers }
 *
 * jsPDF + jspdf-autotable are dynamically imported in exportPDF so they
 * are only loaded when the user actually requests a PDF export (~500 KB).
 */

const getIp = (camera) => (camera.ipAddress || camera.ip || camera.address || '').split(':')[0] || 'N/A';

const normalizeMfr = (mfr) => (mfr || 'Unknown').replace(/\s*\(ONVIF\)\s*$/i, '').trim() || 'Unknown';

/** Build per-manufacturer model breakdown: { mfrName: [[model, count], ...] } */
const buildMfrModelData = (cameras, mfrBreakdown) => {
  const result = {};
  mfrBreakdown.forEach(([mfr]) => {
    const counts = {};
    cameras
      .filter(c => normalizeMfr(c.manufacturer) === mfr)
      .forEach(c => {
        const model = c.model || c.deviceModel || 'Unknown';
        counts[model] = (counts[model] || 0) + 1;
      });
    result[mfr] = Object.entries(counts).sort(([, a], [, b]) => b - a);
  });
  return result;
};

const pct = (n, total) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
const filename = (ext) => `camera-statistics-${new Date().toISOString().slice(0, 10)}.${ext}`;

// ── CSV ───────────────────────────────────────────────────────────────────────

export const exportCSV = ({ cameras, filteredCount, offlineCount, mfrBreakdown, servers }) => {
  const onlineCount = filteredCount - offlineCount;
  const mfrModelData = buildMfrModelData(cameras, mfrBreakdown);
  const offlineCameras = cameras.filter(c => c.connectionState && c.connectionState !== 'CONNECTED');
  const getServerName = (id) => servers.find(s => s.id === id)?.name || 'N/A';

  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (...cols) => cols.map(escape).join(',');
  const blank = () => '';

  const lines = [
    row('Camera Statistics Report'),
    row(`Generated: ${new Date().toLocaleString()}`),
    blank(),

    row('SUMMARY'),
    row('Metric', 'Count', 'Percentage'),
    row('Total Active Cameras', filteredCount, '100%'),
    row('Cameras Online', onlineCount, pct(onlineCount, filteredCount)),
    row('Cameras Offline', offlineCount, pct(offlineCount, filteredCount)),
    blank(),

    row('BY MANUFACTURER'),
    row('Manufacturer', 'Camera Count', '% of Fleet'),
    ...mfrBreakdown.map(([mfr, count]) => row(mfr, count, pct(count, filteredCount))),
    blank(),

    row('BY MODEL'),
    row('Manufacturer', 'Model', 'Count', '% of Manufacturer', '% of Fleet'),
    ...mfrBreakdown.flatMap(([mfr, mfrCount]) =>
      (mfrModelData[mfr] || []).map(([model, count]) =>
        row(mfr, model, count, pct(count, mfrCount), pct(count, filteredCount))
      )
    ),
  ];

  if (offlineCameras.length > 0) {
    lines.push(
      blank(),
      row(`OFFLINE CAMERAS (${offlineCameras.length})`),
      row('Name', 'Status', 'IP Address', 'Model', 'Manufacturer', 'Server'),
      ...offlineCameras.map(c =>
        row(
          c.name || c.deviceName || 'Unnamed',
          c.connectionState || 'Unknown',
          getIp(c),
          c.model || c.deviceModel || 'N/A',
          normalizeMfr(c.manufacturer),
          getServerName(c.serverId),
        )
      ),
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename('csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ── PDF ───────────────────────────────────────────────────────────────────────

export const exportPDF = async ({ cameras, filteredCount, offlineCount, mfrBreakdown, servers }) => {
  // Lazy-load heavy PDF libraries only when needed
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const onlineCount = filteredCount - offlineCount;
  const mfrModelData = buildMfrModelData(cameras, mfrBreakdown);
  const offlineCameras = cameras.filter(c => c.connectionState && c.connectionState !== 'CONNECTED');
  const getServerName = (id) => servers.find(s => s.id === id)?.name || 'N/A';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  // ── Color palette ──────────────────────────────────────────────────────────
  const BLUE       = [29, 78, 216];
  const BLUE_LIGHT = [239, 246, 255];
  const RED        = [220, 38, 38];
  const RED_LIGHT  = [254, 242, 242];
  const GRAY       = [107, 114, 128];
  const GRAY_LIGHT = [249, 250, 251];
  const WHITE      = [255, 255, 255];

  // ── Shared table config ────────────────────────────────────────────────────
  const tableDefaults = {
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [229, 231, 235], lineWidth: 0.1 },
    alternateRowStyles: { fillColor: GRAY_LIGHT },
    headStyles: { fillColor: BLUE, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5 },
    tableLineColor: [229, 231, 235],
    tableLineWidth: 0.1,
  };

  let y = 0;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - 20) {
      doc.addPage();
      y = 16;
    }
  };

  const sectionHeading = (title) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BLUE);
    doc.text(title, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 1;
  };

  const addTable = (options) => {
    doc.autoTable({ startY: y, ...tableDefaults, ...options });
    y = doc.lastAutoTable.finalY + 7;
  };

  // ── Cover / header band ────────────────────────────────────────────────────
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, pageW, 30, 'F');

  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Camera Statistics Report', margin, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 21);
  doc.text(`${filteredCount} active cameras`, margin, 26);

  y = 38;
  doc.setTextColor(0, 0, 0);

  // ── Summary ────────────────────────────────────────────────────────────────
  sectionHeading('Summary');
  addTable({
    head: [['Metric', 'Count', 'Percentage']],
    body: [
      ['Total Active Cameras', filteredCount, '100%'],
      ['Cameras Online', onlineCount, pct(onlineCount, filteredCount)],
      ['Cameras Offline', offlineCount, pct(offlineCount, filteredCount)],
    ],
    columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 30, halign: 'center' } },
    // Colour the offline row red if there are any
    didParseCell: (data) => {
      if (data.row.index === 2 && data.section === 'body') {
        data.cell.styles.textColor = RED;
        data.cell.styles.fontStyle = offlineCount > 0 ? 'bold' : 'normal';
      }
    },
  });

  // ── By Manufacturer ────────────────────────────────────────────────────────
  sectionHeading('By Manufacturer');
  addTable({
    head: [['Manufacturer', 'Camera Count', '% of Fleet']],
    body: mfrBreakdown.map(([mfr, count]) => [mfr, count, pct(count, filteredCount)]),
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
  });

  // ── By Model ───────────────────────────────────────────────────────────────
  sectionHeading('By Model');
  const modelRows = mfrBreakdown.flatMap(([mfr, mfrCount]) =>
    (mfrModelData[mfr] || []).map(([model, count]) => [
      mfr, model, count, pct(count, mfrCount), pct(count, filteredCount),
    ])
  );

  // Group rows by manufacturer with subtle shading
  const mfrColors = {};
  let colorToggle = false;
  mfrBreakdown.forEach(([mfr]) => {
    mfrColors[mfr] = colorToggle ? BLUE_LIGHT : WHITE;
    colorToggle = !colorToggle;
  });

  addTable({
    head: [['Manufacturer', 'Model', 'Count', '% of Mfr', '% of Fleet']],
    body: modelRows,
    columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const mfr = data.row.raw[0];
        if (mfrColors[mfr]) data.cell.styles.fillColor = mfrColors[mfr];
      }
    },
    // Override alternateRowStyles so our per-mfr colors take precedence
    alternateRowStyles: {},
  });

  // ── Offline Cameras ────────────────────────────────────────────────────────
  if (offlineCameras.length > 0) {
    sectionHeading(`Offline Cameras (${offlineCameras.length})`);
    addTable({
      head: [['Name', 'IP Address', 'Model', 'Manufacturer', 'Server']],
      body: offlineCameras.map(c => [
        c.name || c.deviceName || 'Unnamed',
        getIp(c),
        c.model || c.deviceModel || 'N/A',
        normalizeMfr(c.manufacturer),
        getServerName(c.serverId),
      ]),
      headStyles: { fillColor: RED, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: RED_LIGHT },
    });
  }

  // ── Page numbers ───────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
    doc.text('Avigilon Dashboard — Camera Statistics', margin, pageH - 8);
  }

  doc.save(filename('pdf'));
};
