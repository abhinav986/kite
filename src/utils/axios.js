import axios from 'axios';
export const basePath = process.env.REACT_APP_API_BASE_URL || '/api/';
export const get = (url) => axios.get(basePath + url);
export const post = (url, payload) => axios.post(basePath + url, payload);
export const del = (url) => axios.delete(basePath + url);
