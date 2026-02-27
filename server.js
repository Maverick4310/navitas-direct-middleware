/**
 * Navitas Direct Middleware
 * 
 * Express server that sits between partner Salesforce orgs
 * and the Navitas Credit API. Handles HMAC authentication,
 * locality lookups, and credit application submissions.
 * 
 * Deploy to Render as a Web Service connected to this GitHub repo.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authMiddleware = require('./middleware/auth');
const localitiesRouter = require('./routes/localities');
const submitRouter = require('./routes/submit');
const healthRouter = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global Middleware ───
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// ─── Public Routes (no auth) ───
app.use('/health', healthRouter);

// ─── Protected Routes (require partner API key) ───
app.use('/api/localities', authMiddleware, localitiesRouter);
app.use('/api/submit', authMiddleware, submitRouter);

// ─── 404 Handler ───
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ─── Error Handler ───
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
});

app.listen(PORT, () => {
    console.log(`Navitas Direct Middleware running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
