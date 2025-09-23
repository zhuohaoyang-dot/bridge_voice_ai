const express = require('express');
const router = express.Router();
const multer = require('multer');
const campaignController = require('../controllers/campaignController');

// Configure multer for CSV uploads
const upload = multer({
    dest: 'data/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    }
});

// Start a new campaign
router.post('/start', campaignController.startCampaign);

// Stop current campaign
router.post('/stop', campaignController.stopCampaign);

// Get campaign status
router.get('/status/:campaignId', campaignController.getCampaignStatus);

// Get all campaigns
router.get('/', campaignController.getAllCampaigns);

// Upload CSV for campaign
router.post('/upload', upload.single('csv'), campaignController.uploadCSV);

// Schedule a campaign
router.post('/schedule', campaignController.scheduleCampaign);

module.exports = router;