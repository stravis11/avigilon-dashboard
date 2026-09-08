// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CameraStats from './CameraStats';

vi.mock('../services/apiService', () => ({ default: {} }));
vi.mock('../utils/exportReport', () => ({ exportCSV: vi.fn(), exportPDF: vi.fn() }));
vi.mock('../context/CameraDataContext', () => ({ useCameraData: () => ({
  cameras: ['CONNECTED', 'DISCONNECTED'].flatMap((connectionState, i) => [
    { id: `${i}a`, name: `${i} H6 (1)`, ipAddress: `10.0.${i}.1`, manufacturer: 'Avigilon', model: 'H6A', connectionState },
    { id: `${i}b`, name: `${i} H6 (2)`, ipAddress: `10.0.${i}.1`, manufacturer: 'Avigilon (ONVIF)', model: 'H6A', connectionState },
    { id: `${i}c`, name: `${i} H5`, ipAddress: `10.0.${i}.2`, manufacturer: 'Avigilon', deviceModel: 'H5A', connectionState },
    { id: `${i}d`, name: `${i} Pelco`, ipAddress: `10.0.${i}.3`, manufacturer: 'Pelco (ONVIF)', model: 'P1', connectionState },
    { id: `${i}e`, name: `${i} Unknown`, ipAddress: `10.0.${i}.4`, connectionState },
    { id: `${i}s`, name: 'Standby', ipAddress: `10.0.${i}.5`, manufacturer: 'Avigilon', model: 'H6A', connectionState, serverId: 'standby' },
  ]).concat({ id: 'stale', name: 'Migrated', ipAddress: '10.0.0.1', manufacturer: 'Avigilon', model: 'H6A', connectionState: 'DISCONNECTED' }),
  servers: [{ id: 'standby', name: 'GTPDACCSERVER10' }], loading: false, refresh: vi.fn(),
}) }));

afterEach(cleanup);
const click = name => fireEvent.click(screen.getByRole('button', { name }));
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const expectRows = (count, state) => {
  expect(rows()).toHaveLength(count);
  rows().forEach(row => {
    if (state) expect(within(row).getByText(state)).toBeTruthy();
    expect(row.textContent).not.toMatch(/Standby|Migrated/);
  });
};

describe('Camera Statistics drill-down', () => {
  for (const [title, state, devices] of [
    ['Camera Views Online', 'CONNECTED', false],
    ['Camera Devices Online', 'CONNECTED', true],
    ['Camera Views Offline', 'DISCONNECTED', false],
    ['Camera Devices Offline', 'DISCONNECTED', true],
  ]) {
    it(`${title} filters table by manufacturer, generation, model and clears each level`, () => {
      render(<CameraStats />);
      click(new RegExp(`^${title}`));
      expectRows(devices ? 4 : 5, state);
      expect(screen.getByRole('button', { name: /^Avigilon / }).textContent).toContain('50.00%');
      click(/^Avigilon /);
      expectRows(devices ? 2 : 3, state);
      expect(screen.getByRole('heading', { name: `${title} — Avigilon` })).toBeTruthy();
      click(/^H6 /);
      expectRows(devices ? 1 : 2, state);
      rows().forEach(row => expect(within(row).getByText('H6A')).toBeTruthy());
      click(/^H6A /);
      expectRows(devices ? 1 : 2, state);
      click(/^H6A /);
      expectRows(devices ? 1 : 2, state);
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[1]);
      expectRows(devices ? 2 : 3, state);
      click(/^H5 /);
      click(/^H5A /);
      expectRows(1, state);
      click(/^Pelco /);
      expectRows(1, state);
      expect(within(rows()[0]).getByText('P1')).toBeTruthy();
      click(/^P1 /);
      expectRows(1, state);
      click('Clear');
      expectRows(devices ? 4 : 5, state);
      click(/^Unknown /);
      expectRows(1, state);
      fireEvent.click(screen.getAllByRole('button', { name: /^Unknown / })[0]); // toggle manufacturer off
      expectRows(devices ? 4 : 5, state);
      click(/^Avigilon /);
      click(/^H6 /);
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
      click(/^Avigilon /);
      expectRows(devices ? 2 : 3, state);
    });
  }
  it('shows manufacturer rows without a status card and resets filters on card changes', () => {
    render(<CameraStats />);
    click(/^Avigilon /);
    expectRows(6);
    click(/^H6 /);
    expectRows(4);
    click(/^Camera Devices Offline/);
    expectRows(4, 'DISCONNECTED');
    click(/^Pelco /);
    expectRows(1, 'DISCONNECTED');
    click(/^Camera Views Online/);
    expectRows(5, 'CONNECTED');
  });
});
