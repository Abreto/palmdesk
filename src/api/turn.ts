import axios from 'axios';

import { AXIOS_BASEURL } from '@/constant';
import { getAxiosBaseUrl } from '@/utils/localStorage/app';

export interface RemoteIceConfig {
  iceServers: RTCIceServer[];
  expiresAt: number;
  refreshAfter: number;
}

export async function fetchRemoteIce(token: string, signal: AbortSignal) {
  try {
    // This session token must not pass through the account-token interceptor.
    const { data } = await axios.post<{ code: number; data: RemoteIceConfig }>(
      '/webrtc/ice-servers',
      {},
      {
        baseURL: getAxiosBaseUrl() || AXIOS_BASEURL,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 7000,
        signal,
      }
    );
    const config = data.data;
    if (
      data.code !== 200 ||
      !Array.isArray(config?.iceServers) ||
      !Number.isFinite(config.expiresAt) ||
      !Number.isFinite(config.refreshAfter) ||
      config.expiresAt <= Date.now() ||
      config.refreshAfter >= config.expiresAt
    )
      throw new Error('Invalid ICE configuration');
    return config;
  } catch {
    // Axios errors contain the request headers, including the session token.
    throw new Error('无法获取中继凭据');
  }
}
