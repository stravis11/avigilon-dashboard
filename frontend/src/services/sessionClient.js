import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
export const SESSION_EVENT = 'dashboard-session-changed';
const refreshClient = axios.create({ baseURL: `${API_BASE_URL}/auth`, timeout: 30000 });
let pendingRefresh = null;

export function setSessionTokens(accessToken, refreshToken = localStorage.getItem('refreshToken')) {
  if (accessToken) localStorage.setItem('accessToken', accessToken);
  else localStorage.removeItem('accessToken');
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  else localStorage.removeItem('refreshToken');
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function clearSession() { setSessionTokens(null, null); }

export function renewAccessToken() {
  if (pendingRefresh) return pendingRefresh;
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) { clearSession(); return Promise.reject(new Error('Please sign in again.')); }
  pendingRefresh = refreshClient.post('/refresh', { refreshToken }).then(({ data }) => {
    // A response from an old session must never restore a logged-out account.
    if (localStorage.getItem('refreshToken') !== refreshToken) throw new Error('Session changed');
    if (!data.success || !data.data?.accessToken) throw new Error('Please sign in again.');
    setSessionTokens(data.data.accessToken, refreshToken);
    return data.data.accessToken;
  }).catch(error => {
    if (localStorage.getItem('refreshToken') === refreshToken && (error.response?.status === 401 || error.response?.status === 403)) clearSession();
    throw error;
  }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

export function createSessionClient(baseURL = API_BASE_URL, { unwrap = false } = {}) {
  const client = axios.create({ baseURL, timeout: 180000 });
  client.interceptors.request.use(config => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    else delete config.headers.Authorization;
    return config;
  });
  client.interceptors.response.use(response => unwrap ? response.data : response, async error => {
    if (error.response?.data?.error) error.message = error.response.data.error;
    const request = error.config;
    if (error.response?.status !== 401 || !request || request._retry || ['/login', '/refresh'].includes(request.url)) throw error;
    request._retry = true;
    const current = localStorage.getItem('accessToken');
    const token = current && request.headers.Authorization !== `Bearer ${current}` ? current : await renewAccessToken();
    request.headers.Authorization = `Bearer ${token}`;
    return client.request(request);
  });
  return client;
}

export async function authenticatedFetch(url, options = {}) {
  const request = token => fetch(url, { ...options, headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const token = localStorage.getItem('accessToken');
  let response = await request(token);
  if (response.status === 401) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const current = localStorage.getItem('accessToken');
    const renewed = current && current !== token ? current : await renewAccessToken();
    response = await request(renewed);
  }
  return response;
}
