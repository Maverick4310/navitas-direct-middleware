/**
 * Health Check Route
 * 
 * Used by Render to verify the service is running,
 * and by partners to test connectivity.
 */

const express = require('express');
const router = express.Router();
const navitas = require('../services/navitasClient');

router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'navitas-direct-middleware',
        navitasConfigured: navitas.isConfigured(),
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
