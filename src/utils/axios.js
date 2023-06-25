import axios from 'axios';
const basePath = '/api/'
export const get = (url) => axios.get(basePath + url);
export const post = (url, payload) => axios.post(basePath + url, payload);