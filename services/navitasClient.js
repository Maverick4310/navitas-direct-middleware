/**
 * Navitas API Client
 * 
 * Handles HMAC-SHA256 authentication and HTTP communication
 * with the Navitas Connect API. All Navitas credentials are
 * stored as Render environment variables.
 * 
 * Required env vars:
 *   NAVITAS_BASE_URL         — e.g. https://connect-demo2.navitascredit.com
 *   NAVITAS_ATTACH_BASE_URL  — same host: https://connect-demo2.navitascredit.com
 *   NAVITAS_HMAC_CLIENT_ID
 *   NAVITAS_HMAC_SECRET
 *   NAVITAS_API_TOKEN
 */

const crypto = require('crypto');

class NavitasClient {

    constructor() {
        this.baseUrl       = (process.env.NAVITAS_BASE_URL        || '').replace(/\/+$/, '');
        this.attachBaseUrl = (process.env.NAVITAS_ATTACH_BASE_URL || '').replace(/\/+$/, '');
        this.clientId      = process.env.NAVITAS_HMAC_CLIENT_ID || '';
        this.secret        = process.env.NAVITAS_HMAC_SECRET     || '';
        this.apiToken      = process.env.NAVITAS_API_TOKEN        || '';
    }

    /**
     * Validates that all required env vars are set for application submission.
     */
    isConfigured() {
        return this.baseUrl && this.clientId && this.secret && this.apiToken;
    }

    /**
     * Validates that all required env vars are set for document attachment.
     */
    isAttachConfigured() {
        return this.attachBaseUrl && this.clientId && this.secret;
    }

    /**
     * Generates HMAC-SHA256 Authorization header.
     * Format: "HMAC {clientId}:{base64(HmacSHA256(message, secret))}"
     */
    generateHmac(message) {
        console.log('HMAC signing message:', message.substring(0, 200) + (message.length > 200 ? '...' : ''));
        const hmac = crypto.createHmac('sha256', this.secret);
        hmac.update(message);
        const base64Hash = hmac.digest('base64');
        return `HMAC ${this.clientId}:${base64Hash}`;
    }

    /**
     * Makes an authenticated GET request to Navitas.
     */
    async get(path) {
        const url = `${this.baseUrl}${path}`;
        const authorization = this.generateHmac(path);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authorization,
                'Api-Token': this.apiToken,
                'Accept': 'application/json',
                'User-Agent': 'NavitasDirectMiddleware/1.0'
            }
        });

        return this._handleResponse(response, url);
    }

    /**
     * Makes an authenticated POST request to Navitas.
     *
     * IMPORTANT: For POST requests, the HMAC message is path + JSON body.
     * This matches the Postman pre-request script:
     *   reqMessage = '/' + path.join('/') + (request['data'] || '')
     *
     * @param {string} path        - API path (e.g. /v1/application/submit)
     * @param {object} body        - Request payload
     * @param {string} [apiToken]  - Partner-specific Navitas API token.
     *                               Falls back to NAVITAS_API_TOKEN env var
     *                               if not provided (e.g. for non-submission routes).
     */
    async post(path, body, apiToken) {
        const url = `${this.baseUrl}${path}`;
        const bodyStr = JSON.stringify(body);
        const token = apiToken || this.apiToken;

        // POST signing: path + body (GET signing is just path+query)
        const authorization = this.generateHmac(path + bodyStr);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authorization,
                'Api-Token': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'NavitasDirectMiddleware/1.0'
            },
            body: bodyStr  // Use the same string that was signed
        });

        return this._handleResponse(response, url);
    }

    /**
     * Makes an authenticated POST to the attachment endpoint.
     *
     * Uses NAVITAS_ATTACH_BASE_URL instead of NAVITAS_BASE_URL.
     * Signing follows the Postman pre-request script convention for POST:
     *   reqMessage = '/' + path.join('/') + (request['data'] || '')
     * The query string (app_id param) is NOT included in the signed message —
     * only the path segments + body. The full URL (with query string) is still
     * used for the actual fetch.
     *
     * @param {string} path       - Path + query string, e.g.:
     *                              /v1/application/attachment?app_id=12345
     * @param {object} body       - { file_name, data }
     * @param {string} apiToken   - Partner-specific Navitas API token
     *                              (X-Navitas-Token from the partner org).
     */
    async postAttachment(path, body, apiToken) {
        const url     = `${this.attachBaseUrl}${path}`;
        const bodyStr = JSON.stringify(body);
        const token   = apiToken || this.apiToken;

        // Strip query string before signing — Postman signs path segments only,
        // not the query string. Full URL (with ?app_id) is still used for fetch.
        const pathOnly      = path.split('?')[0];
        const authorization = this.generateHmac(pathOnly + bodyStr);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authorization,
                'Api-Token':     token,
                'Content-Type':  'application/json',
                'Accept':        'application/json',
                'User-Agent':    'NavitasDirectMiddleware/1.0'
            },
            body: bodyStr
        });

        return this._handleResponse(response, url);
    }

    /**
     * Processes the Navitas API response.
     * Returns { ok, status, data } or throws with details.
     */
    async _handleResponse(response, url) {
        const contentType = response.headers.get('content-type') || '';
        let data;

        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            const error = new Error(`Navitas API error: HTTP ${response.status}`);
            error.status = response.status;
            error.url = url;
            error.data = data;

            // Check for Cloudflare block (shouldn't happen from Render, but just in case)
            if (typeof data === 'string' && data.includes('Cloudflare')) {
                error.message = 'Navitas API is blocking this server IP (Cloudflare). Contact Navitas support.';
                error.isCloudflare = true;
            }

            throw error;
        }

        return { ok: true, status: response.status, data };
    }
}

// Export singleton instance
module.exports = new NavitasClient();
