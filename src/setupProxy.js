const { createProxyMiddleware } = require('http-proxy-middleware');
const proxy_HOST = 'http://localhost:5000';

module.exports = function(app) {
    app.use(
        '/api/*',
        createProxyMiddleware({
            target: proxy_HOST,
            secure: false,
            changeOrigin: true,
        })
    );
};