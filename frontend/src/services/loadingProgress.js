/**
 * Counts work in flight (API requests, page code downloads) so the top progress bar can show
 * while anything is loading. Framework-free so the HTTP client can report to it directly.
 */
let active = 0;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export const loadingProgress = {
  start() {
    active += 1;
    emit();
  },
  done() {
    active = Math.max(0, active - 1);
    emit();
  },
  getActive: () => active,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Axios interceptors: each request counts once, including a retry after a token refresh. */
export function trackRequests(client) {
  client.interceptors.request.use((config) => {
    if (!config.__progress) {
      config.__progress = true;
      loadingProgress.start();
    }
    return config;
  });
  const finish = (config) => {
    if (config?.__progress) {
      config.__progress = false;
      loadingProgress.done();
    }
  };
  client.interceptors.response.use(
    (response) => {
      finish(response.config);
      return response;
    },
    (error) => {
      finish(error?.config);
      return Promise.reject(error);
    },
  );
}
