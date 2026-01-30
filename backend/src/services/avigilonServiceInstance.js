import AvigilonService from './avigilonService.js';

// Create and export the singleton instance
// This file should only be imported AFTER environment variables are loaded
const avigilonServiceInstance = new AvigilonService();

export default avigilonServiceInstance;
