import { COTURN_URL } from '@/constant';
import {
  getCoturnCredential,
  getCoturnUrl,
  getCoturnUsername,
} from '@/utils/localStorage/app';

export function getIceServers(): RTCIceServer[] {
  const urls = getCoturnUrl() || COTURN_URL;
  if (!urls) return [];
  return [
    {
      urls,
      username: getCoturnUsername() || import.meta.env.VITE_TURN_USERNAME || '',
      credential:
        getCoturnCredential() || import.meta.env.VITE_TURN_CREDENTIAL || '',
    },
  ];
}
