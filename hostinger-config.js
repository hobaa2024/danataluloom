/**
 * Dana Al-Oloom School - Stable Database Adapter
 * Optimized for Hostinger MySQL Deployment
 * V2.0 - Supports Cloud Authentication Fallback
 */

const API_URL = 'api.php';
const MASTER_KEY = 'DANAT2026'; // New Simplified Master Key

async function apiRequest(action, data = null, method = 'POST', customKey = null) {
    const authKey = customKey || MASTER_KEY;

    // Cache-Busting: Add random timestamp to URL to force fresh data from server
    const cacheBuster = `&_t=${Date.now()}`;
    const url = `${API_URL}?action=${action}&key=${encodeURIComponent(authKey)}${cacheBuster}`;

    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    // Correct: Only add body for POST/REPLACE requests
    if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(url, options);
        if (response.status === 401) return { success: false, error: 'Unauthorized' };
        if (response.status === 403) return { success: false, error: 'Forbidden' };

        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            console.warn('API returned non-JSON:', text);
            return null;
        }
    } catch (error) {
        console.error(`API Error (${action}):`, error);
        return null;
    }
}

const CloudDB = {
    async saveStudent(student) {
        const result = await apiRequest('save_student', student);
        return !!(result && result.success);
    },

    async getStudent(id) {
        return await apiRequest('get_student&id=' + id, null, 'GET');
    },

    async getStudents() {
        const data = await apiRequest('get_students', null, 'GET');
        return data || [];
    },

    async updateContract(id, data) {
        const result = await apiRequest('update_contract&id=' + id, data, 'POST');
        return !!(result && result.success);
    },

    async deleteStudent(id) {
        const result = await apiRequest('delete_student&id=' + id, null, 'DELETE');
        return !!(result && result.success);
    },

    listenForUpdates(successCallback, errorCallback) {
        // Initial fetch
        this.getStudents().then(data => {
            if (successCallback) successCallback(data);
        }).catch(err => { if (errorCallback) errorCallback(err); });

        // Continuous sync every 10 seconds (Collaboration Mode)
        setInterval(() => {
            this.getStudents().then(data => {
                if (data && successCallback) successCallback(data);
            }).catch(() => { });
        }, 5000);
    },

    async syncLocalToCloud() {
        const localStudents = JSON.parse(localStorage.getItem('students') || '[]');
        const localSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
        const localTmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');

        for (const s of localStudents) await this.saveStudent(s);
        if (Object.keys(localSettings).length > 0) await this.saveSettings(localSettings);
        for (const t of localTmpls) await this.saveContractTemplate(t);

        return true;
    },

    async syncCloudToLocal() {
        console.log('🔄 Safely recovering cloud data...');

        // 1. Fetch all data types
        const students = await this.getStudents();
        const settings = await this.getSettings();
        const templates = await this.getContractTemplates();

        // 2. Sync Students using the robust 'No-Delete' merge logic (handles heavy data)
        if (students && Array.isArray(students)) {
            if (typeof db !== 'undefined' && db.mergeRemoteData) {
                await db.mergeRemoteData(students);
                console.log(`✅ ${students.length} students sync'd through safe pipeline`);
            } else {
                localStorage.setItem('students', JSON.stringify(students));
            }
        }

        // 3. Sync Settings
        if (settings && settings.adminUsername) {
            localStorage.setItem('appSettings', JSON.stringify(settings));
        }

        // 4. Sync Templates (handles heavy PDF data)
        if (templates && Array.isArray(templates)) {
            if (typeof db !== 'undefined' && db.syncTemplatesLocally) {
                await db.syncTemplatesLocally(templates);
            } else {
                localStorage.setItem('contractTemplates', JSON.stringify(templates));
            }
        }

        // 5. Final UI Refresh
        if (typeof UI !== 'undefined' && UI.refreshData) {
            UI.refreshData();
        }

        return true;
    },

    async saveSettings(settings) {
        const result = await apiRequest('save_settings', settings);
        return !!(result && result.success);
    },

    async getSettings(user = null, pass = null) {
        let key = MASTER_KEY;
        if (user && pass) key = `${user}:${pass}`;
        return await apiRequest('get_settings', null, 'GET', key);
    },

    async listenForSettings(callback) {
        // Initial fetch
        const s = await this.getSettings();
        if (s && callback) callback(s);

        // Continuous poll for settings (Collaboration)
        setInterval(async () => {
            const s = await this.getSettings();
            if (s && callback) callback(s);
        }, 8000);
    },

    async getContractTemplates() {
        const data = await apiRequest('get_templates', null, 'GET');
        return data || [];
    },

    async listenForTemplates(callback) {
        // Initial fetch
        const t = await this.getContractTemplates();
        if (t && callback) callback(t);

        // Continuous poll for templates (Collaboration)
        setInterval(async () => {
            const t = await this.getContractTemplates();
            if (t && callback) callback(t);
        }, 10000);
    },

    async saveContractTemplate(template) {
        const result = await apiRequest('save_template', template);
        return !!(result && result.success);
    },

    async deleteContractTemplate(id) {
        const result = await apiRequest('delete_template&id=' + id, null, 'DELETE');
        return !!(result && result.success);
    },

    isReady() { return true; },
    monitorConnection(callback) { callback(true); }
};
