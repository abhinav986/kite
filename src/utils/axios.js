import axios from 'axios';
export const basePath = process.env.REACT_APP_API_BASE_URL || '/api/';

// The backend protects orders, account data, scanner, signals and backtest with ADMIN_PASSWORD.
// The password is asked for once and kept in this browser; a wrong one is asked for again.
const PASSWORD_KEY = 'adminPassword';

const readPassword = () => {
    try {
        return localStorage.getItem(PASSWORD_KEY) || '';
    } catch {
        return '';
    }
};

const savePassword = (value) => {
    try {
        if (value) localStorage.setItem(PASSWORD_KEY, value);
        else localStorage.removeItem(PASSWORD_KEY);
    } catch {
        // storage blocked: the password is asked for again next time
    }
};

// many polling requests can fail at once; they share a single prompt. After Cancel, polling doesn't
// keep re-asking - reload the page to enter it.
let pendingPrompt = null;
let declined = false;
const askForPassword = (message) => {
    if (declined) return Promise.resolve('');
    if (!pendingPrompt) {
        pendingPrompt = Promise.resolve(window.prompt(message) || '').then((value) => {
            pendingPrompt = null;
            declined = !value;
            savePassword(value);
            return value;
        });
    }
    return pendingPrompt;
};

axios.interceptors.request.use((config) => {
    const password = readPassword();
    if (password) config.headers['X-Admin-Password'] = password;
    return config;
});

axios.interceptors.response.use(null, async (error) => {
    const { config, response } = error;
    const code = response?.data?.code;
    if (response?.status === 401 && (code === 'admin_password_required' || code === 'admin_password_invalid') && !config._passwordRetry) {
        const message = code === 'admin_password_invalid' ? 'Wrong password. Enter the app password:' : 'Enter the app password:';
        const password = await askForPassword(message);
        if (password) {
            config._passwordRetry = true;
            config.headers['X-Admin-Password'] = password;
            return axios(config);
        }
    }
    return Promise.reject(error);
});

export const get = (url) => axios.get(basePath + url);
export const post = (url, payload) => axios.post(basePath + url, payload);
export const del = (url) => axios.delete(basePath + url);
