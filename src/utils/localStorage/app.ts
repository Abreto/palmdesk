import { CLIENT_BASE_URL, LS_KEY } from '@/constant';
import cache from '@/utils/cache';

export const getAxiosBaseUrl = () => {
  return cache.getStorage<string>(LS_KEY.axiosBaseUrl);
};
export const setAxiosBaseUrl = (val: string) => {
  return cache.setStorage(LS_KEY.axiosBaseUrl, val);
};
export const clearAxiosBaseUrl = () => {
  return cache.clearStorage(LS_KEY.axiosBaseUrl);
};

export const getWssUrl = () => {
  return cache.getStorage<string>(LS_KEY.wssUrl);
};
export const setWssUrl = (val: string) => {
  return cache.setStorage(LS_KEY.wssUrl, val);
};
export const clearWssUrl = () => {
  return cache.clearStorage(LS_KEY.wssUrl);
};

export const getCoturnUrl = () => {
  return cache.getStorage<string>(LS_KEY.coturnUrl);
};
export const setCoturnUrl = (val: string) => {
  return cache.setStorage(LS_KEY.coturnUrl, val);
};
export const clearCoturnUrl = () => {
  return cache.clearStorage(LS_KEY.coturnUrl);
};

export const getCoturnUsername = () =>
  cache.getStorage<string>(LS_KEY.coturnUsername);
export const setCoturnUsername = (value: string) =>
  cache.setStorage(LS_KEY.coturnUsername, value);
export const getCoturnCredential = () =>
  cache.getStorage<string>(LS_KEY.coturnCredential);
export const setCoturnCredential = (value: string) =>
  cache.setStorage(LS_KEY.coturnCredential, value);

export const getClientUrl = () =>
  cache.getStorage<string>(LS_KEY.clientUrl) || CLIENT_BASE_URL || '';
export const setClientUrl = (value: string) =>
  cache.setStorage(LS_KEY.clientUrl, value);
