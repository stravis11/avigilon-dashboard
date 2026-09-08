// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CameraThumbnail } from './Cameras';
import apiService from '../services/apiService';
vi.mock('../services/apiService', () => ({ default: { fetchCameraSnapshotBlob: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
for (const late of [false, true]) it(`revokes thumbnails ${late ? 'resolved after unmount' : 'loaded before unmount'}`, async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} });
  const revoke = vi.fn(); vi.stubGlobal('URL', { revokeObjectURL: revoke });
  let resolve;
  apiService.fetchCameraSnapshotBlob.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<CameraThumbnail cameraId="camera" />);
  await act(async () => { vi.runAllTimers(); });
  if (late) view.unmount();
  await act(async () => { resolve('blob:test-thumbnail'); });
  if (!late) view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:test-thumbnail');
});
