/**
 * Localities Route
 * 
 * Resolves city, state, and county from a zip code
 * by calling the Navitas Connect localities endpoint.
 * 
 * GET /api/localities?zipcode=10471
 * 
 * Returns:
 * [
 *   { "city": "New York", "state": "NY", "zip": "10471", "county": "Bronx" }
 * ]
 */

const express = require('express');
const router = express.Router();
const navitas = require('../services/navitasClient');

router.get('/', async (req, res) => {
    try {
        let { zipcode } = req.query;

        // ─── Validate ───
        if (!zipcode || !/^\d{5}/.test(zipcode.trim())) {
            return res.status(400).json({
                error: 'Invalid zip code',
                message: 'Provide a 5-digit US zip code as ?zipcode=XXXXX'
            });
        }

        zipcode = zipcode.trim().substring(0, 5);

        // ─── Check config ───
        if (!navitas.isConfigured()) {
            return res.status(503).json({
                error: 'Service not configured',
                message: 'Navitas API credentials are not set on the server'
            });
        }

        // ─── Call Navitas ───
        const path = `/v1/localities?zipcode=${zipcode}`;
        const result = await navitas.get(path);

        // ─── Title-case city and county ───
        const localities = Array.isArray(result.data) ? result.data : [];
        const formatted = localities.map(loc => ({
            city:   toTitleCase(loc.city || ''),
            state:  loc.state || '',
            zip:    loc.zip || zipcode,
            county: toTitleCase(loc.county || '')
        }));

        res.json(formatted);

    } catch (err) {
        console.error('Locality lookup error:', err.message);
        res.status(err.status || 500).json({
            error: 'Locality lookup failed',
            message: err.message,
            isCloudflare: err.isCloudflare || false
        });
    }
});

/**
 * Converts ALL CAPS to Title Case.
 * "NEW YORK" → "New York"
 */
function toTitleCase(str) {
    if (!str) return str;
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = router;
