// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
const { adapter } = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock('axios', async original => {
  const module = await original();
  return { ...module, default: { ...module.default, create: options => module.default.create({ ...options, adapter }) } };
});
import { createSessionClient, authenticatedFetch, renewAccessToken, setSessionTokens, clearSession } from './sessionClient';
import { AuthProvider, useAuth } from '../context/AuthContext';
import authService from './authService';
import apiService from './apiService';

beforeEach(() => { localStorage.clear(); adapter.mockReset(); setSessionTokens('expired', 'refresh'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });
const unauthorized = config => { throw Object.assign(new Error('expired'), { config, response: { status: 401, data: { error: 'Token expired' } } }); };
function defaultAdapter(config) {
  if (config.url === '/refresh') return Promise.resolve(reply(config, { success: true, data: { accessToken: 'fresh' } }));
  if (config.headers.Authorization === 'Bearer expired') return unauthorized(config);
  return Promise.resolve(reply(config, { success: true, data: { id: 'user', role: 'admin' } }));
}
it('concurrent API requests share one refresh and preserve the unwrapped response shape', async () => {
  adapter.mockImplementation(defaultAdapter);
  const client = createSessionClient('/api', { unwrap: true });
  const responses = await Promise.all([client.get('/cameras'), client.get('/sites')]);
  expect(responses.every(response => response.success)).toBe(true);
  expect(adapter.mock.calls.filter(([config]) => config.url === '/refresh')).toHaveLength(1);
});
it('profile/user management ignore stale supplied tokens and context observes renewal', async () => {
  adapter.mockImplementation(defaultAdapter);
  const Probe = () => <span>{useAuth().accessToken}</span>;
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('fresh')).toBeTruthy());
  await authService.getUsers('expired');
  const request = adapter.mock.calls.find(([config]) => config.url === '/users')[0];
  expect(request.headers.Authorization).toBe('Bearer fresh');
});
it('the server information URL matches the backend route', async () => {
  setSessionTokens('fresh', 'refresh'); adapter.mockImplementation(defaultAdapter);
  await apiService.getServerInfo();
  expect(adapter.mock.calls[0][0].url).toBe('/server');
});
it('live-video fetch renews expired access and preserves abort signals', async () => {
  adapter.mockImplementation(defaultAdapter);
  const fetch = vi.fn().mockResolvedValueOnce({ status: 401 }).mockResolvedValueOnce({ status: 200 });
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect((await authenticatedFetch('/api/cameras/c/stream/manifest', { signal })).status).toBe(200);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  expect(fetch.mock.calls[1][1].signal).toBe(signal);
});
it('a refresh finishing after logout cannot restore the session', async () => {
  let complete;
  adapter.mockImplementation(config => new Promise(resolve => { complete = () => resolve(reply(config, { success: true, data: { accessToken: 'late' } })); }));
  const refresh = renewAccessToken();
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  clearSession(); complete();
  await expect(refresh).rejects.toThrow('Session changed');
  expect(localStorage.getItem('accessToken')).toBeNull();
});
it('revoked refresh clears authentication instead of retrying indefinitely', async () => {
  adapter.mockImplementation(unauthorized);
  await expect(createSessionClient().get('/cameras')).rejects.toThrow();
  expect(localStorage.getItem('accessToken')).toBeNull();
  expect(adapter).toHaveBeenCalledTimes(2);
});
