import { apiClient } from './apiClient';

/** No sign-in needed: the QR self-enrollment page. */
export async function getJoinInfo(token) {
  const response = await apiClient.get(`/public/enroll/${encodeURIComponent(token)}`, { skipAuthRefresh: true });
  return response.data.data;
}

export async function selfEnroll(token, data) {
  const response = await apiClient.post(`/public/enroll/${encodeURIComponent(token)}`, data, { skipAuthRefresh: true });
  return response.data.data;
}
