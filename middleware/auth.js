/**
 * Partner Authentication Middleware
 * 
 * Validates that incoming requests from Salesforce partner orgs
 * include a valid API key. Keys are stored as a comma-separated
 * list in the PARTNER_API_KEYS environment variable on Render.
 * 
 * Salesforce Apex sends the key via the X-Api-Key header.
 */

function authMiddleware(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing X-Api-Key header'
        });
    }

    const validKeys = (process.env.PARTNER_API_KEYS || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

    if (validKeys.length === 0) {
        console.error('PARTNER_API_KEYS env var is not configured');
        return res.status(500).json({
            error: 'Server configuration error',
            message: 'Partner authentication is not configured'
        });
    }

    if (!validKeys.includes(apiKey)) {
        console.warn(`Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid API key'
        });
    }

    next();
}

module.exports = authMiddleware;
