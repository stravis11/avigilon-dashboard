// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
const { saved } = vi.hoisted(() => ({ saved: vi.fn() }));
vi.mock('jspdf', async original => {
  const module = await original();
  return { ...module, jsPDF: function (...args) {
    const doc = new module.jsPDF(...args);
    doc.save = name => { saved(name, doc.output('arraybuffer')); return doc; };
    return doc;
  } };
});
import { exportPDF } from './exportReport';
it('exports a real PDF using the upgraded table API', async () => {
  await exportPDF({ cameras: [{ id: '1', name: 'Test camera', manufacturer: 'Avigilon', model: 'H6A', ipAddress: '10.0.0.1', connectionState: 'CONNECTED' }], filteredCount: 1, offlineCount: 0, mfrBreakdown: [['Avigilon', 1]], servers: [] });
  expect(saved).toHaveBeenCalledOnce();
  const [name, bytes] = saved.mock.calls[0];
  expect(name).toMatch(/\.pdf$/);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
  expect(bytes.byteLength).toBeGreaterThan(1000);
});
