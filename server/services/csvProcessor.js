const fs = require('fs').promises;
const { parse } = require('csv-parse');
const logger = require('../utils/logger');

class CSVProcessor {
    constructor() {
        this.requiredColumns = [
            'first_name',
            'last_name',
            'phone_number',
            'lead_source',
            'case_type',
            'organizationid',
            'leadid'
        ];
    }

    // Parse CSV file
    async parseCSV(filePath) {
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            
            return new Promise((resolve, reject) => {
                parse(fileContent, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true,
                    cast: true,
                    cast_date: false
                }, (err, records) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Normalize column names to lowercase
                        const normalizedRecords = records.map(record => {
                            const normalized = {};
                            Object.keys(record).forEach(key => {
                                normalized[key.toLowerCase().trim()] = record[key];
                            });
                            return normalized;
                        });
                        resolve(normalizedRecords);
                    }
                });
            });
        } catch (error) {
            logger.error('Error parsing CSV:', error);
            throw error;
        } finally {
            // Clean up uploaded file
            try {
                await fs.unlink(filePath);
            } catch (err) {
                logger.warn('Failed to delete uploaded file:', err);
            }
        }
    }

    // Validate CSV structure
    validateCSVStructure(data) {
        const errors = [];
        
        if (!data || data.length === 0) {
            errors.push('CSV file is empty');
            return { valid: false, errors };
        }

        // Check for required columns
        const columns = Object.keys(data[0]);
        const missingColumns = this.requiredColumns.filter(
            col => !columns.includes(col)
        );

        if (missingColumns.length > 0) {
            errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
        }

        // Check for duplicate leadIds
        const leadIds = data.map(row => row.leadid).filter(Boolean);
        const uniqueLeadIds = new Set(leadIds);
        if (leadIds.length !== uniqueLeadIds.size) {
            errors.push('Duplicate leadId values found');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Process and validate contacts
    processContacts(data) {
        return data.map((row, index) => {
            const processed = {
                ...row,
                row_number: index + 1,
                phone_valid: false,
                phone_formatted: '',
                validation_errors: []
            };

            // Validate and format phone number
            const phoneValidation = this.validatePhoneNumber(row.phone_number);
            processed.phone_valid = phoneValidation.valid;
            processed.phone_formatted = phoneValidation.formatted;
            processed.phone_number = phoneValidation.formatted; // Update the phone number to formatted version
            
            if (!phoneValidation.valid) {
                processed.validation_errors.push(phoneValidation.error);
            }

            // Validate required fields
            if (!row.first_name || !row.last_name) {
                processed.validation_errors.push('Missing name information');
            }

            if (!row.leadid) {
                processed.validation_errors.push('Missing leadId');
            }

            // Clean and validate other fields
            processed.lead_source = this.cleanString(row.lead_source);
            processed.case_type = this.cleanString(row.case_type);
            processed.organizationid = this.cleanString(row.organizationid);

            return processed;
        });
    }

    // Validate and format phone number
    validatePhoneNumber(phone) {
        if (!phone) {
            return { valid: false, error: 'Phone number is empty' };
        }

        // Remove all non-numeric characters
        const cleaned = String(phone).replace(/\D/g, '');

        // Check length
        if (cleaned.length < 10) {
            return { valid: false, error: 'Phone number too short' };
        }

        if (cleaned.length > 15) {
            return { valid: false, error: 'Phone number too long' };
        }

        // Format to E.164
        let formatted;
        if (cleaned.length === 10) {
            // US number without country code
            formatted = '+1' + cleaned;
        } else if (cleaned.length === 11 && cleaned[0] === '1') {
            // US number with country code
            formatted = '+' + cleaned;
        } else {
            // International number
            formatted = '+' + cleaned;
        }

        return {
            valid: true,
            formatted,
            original: phone
        };
    }

    // Clean string values
    cleanString(value) {
        if (!value) return '';
        return String(value).trim();
    }

    // Generate CSV summary
    generateSummary(processedData) {
        const summary = {
            total: processedData.length,
            valid: 0,
            invalid: 0,
            byLeadSource: {},
            byCaseType: {},
            byOrganization: {},
            invalidNumbers: []
        };

        processedData.forEach(contact => {
            if (contact.phone_valid) {
                summary.valid++;
            } else {
                summary.invalid++;
                summary.invalidNumbers.push({
                    row: contact.row_number,
                    name: `${contact.first_name} ${contact.last_name}`,
                    phone: contact.phone_number,
                    errors: contact.validation_errors
                });
            }

            // Group by lead source
            if (contact.lead_source) {
                summary.byLeadSource[contact.lead_source] = 
                    (summary.byLeadSource[contact.lead_source] || 0) + 1;
            }

            // Group by case type
            if (contact.case_type) {
                summary.byCaseType[contact.case_type] = 
                    (summary.byCaseType[contact.case_type] || 0) + 1;
            }

            // Group by organization
            if (contact.organizationid) {
                summary.byOrganization[contact.organizationid] = 
                    (summary.byOrganization[contact.organizationid] || 0) + 1;
            }
        });

        return summary;
    }

    // Export processed data to CSV
    async exportToCSV(data, outputPath) {
        const headers = [
            'row_number',
            'first_name',
            'last_name',
            'phone_number',
            'phone_formatted',
            'phone_valid',
            'lead_source',
            'case_type',
            'organizationid',
            'leadid',
            'validation_errors'
        ];

        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    const value = row[header];
                    // Escape values containing commas or quotes
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value || '';
                }).join(',')
            )
        ].join('\n');

        await fs.writeFile(outputPath, csvContent, 'utf-8');
        logger.info(`Exported processed CSV to ${outputPath}`);
    }
}

module.exports = new CSVProcessor();