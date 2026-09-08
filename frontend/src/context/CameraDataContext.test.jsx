// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
const { auth, api } = vi.hoisted(() => ({ auth: { isAuthenticated: true }, api: Object.fromEntries(['getServers', 'getCameras', 'getSites', 'getDashboardStats', 'getCacheStatus', 'refreshCache'].map(name => [name, vi.fn()])) }));
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../services/apiService', () => ({ default: api }));
import { CameraDataProvider, useCameraData } from './CameraDataContext';
const Probe = () => { const data = useCameraData(); return <><span>{data.cameras.map(c => c.name).join(',') || 'empty'}</span><span>{data.error}</span><button onClick={data.refresh}>Refresh data</button></>; };
beforeEach(() => {
  auth.isAuthenticated = true;
  Object.values(api).forEach(mock => mock.mockReset());
  api.getServers.mockResolvedValue({ data: { servers: [] } });
  api.getCameras.mockResolvedValue({ data: { cameras: [{ id: '1', name: 'Last known camera' }] } });
  api.getSites.mockResolvedValue({ data: { sites: [] } });
  api.getDashboardStats.mockResolvedValue({ data: {} });
  api.getCacheStatus.mockResolvedValue({ data: { isStale: true, lastRefreshed: '2026-09-08T10:00:00Z' } });
});
afterEach(cleanup);
it('preserves inventory and shows stale status when manual refresh fails', async () => {
  api.refreshCache.mockRejectedValue(new Error('Offline'));
  render(<CameraDataProvider><Probe /></CameraDataProvider>);
  await screen.findByText('Last known camera');
  await act(async () => { screen.getByText('Refresh data').click(); });
  expect(screen.getByText('Last known camera')).toBeTruthy();
  expect(screen.getByText(/Showing the last available inventory/)).toBeTruthy();
});
it('does not restore camera data from a request completed after logout', async () => {
  let complete;
  api.getCameras.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const view = render(<CameraDataProvider><Probe /></CameraDataProvider>);
  auth.isAuthenticated = false;
  view.rerender(<CameraDataProvider><Probe /></CameraDataProvider>);
  await act(async () => { complete({ data: { cameras: [{ id: 'old', name: 'Old session camera' }] } }); });
  expect(screen.queryByText('Old session camera')).toBeNull();
  expect(screen.getByText('empty')).toBeTruthy();
});
