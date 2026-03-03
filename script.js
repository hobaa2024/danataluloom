// Inject Embedded Cairo Font for Dashboard Accuracy
if (typeof GLOBAL_CAIRO_FONT !== 'undefined' && GLOBAL_CAIRO_FONT) {
    const fontStyles = `
        @font-face {
            font-family: 'CairoEmbedded';
            src: url(data:font/ttf;base64,${GLOBAL_CAIRO_FONT});
            font-weight: normal;
            font-style: normal;
        }
        body, .card, .btn, .nav-link, table td, table th { font-family: 'CairoEmbedded', 'Cairo', sans-serif !important; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = fontStyles;
    document.head.appendChild(styleSheet);
}

// Database Management using LocalStorage
class DatabaseManager {
    constructor() {
        this.init();
    }

    init() {
        console.log('DatabaseManager Initializing...');

        // Load settings first (needed for branding etc)
        this.loadSettings();

        // Safe recovery from cloud
        if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            this.updateCloudStatus('connecting');
            CloudDB.syncCloudToLocal().finally(() => {
                this.updateCloudStatus('online');
            });

            // Re-Sync templates and status periodically
            CloudDB.listenForUpdates(remoteStudents => {
                this.updateCloudStatus('online');
                if (remoteStudents && Array.isArray(remoteStudents)) {
                    console.log(`☁️ Cloud update received: ${remoteStudents.length} students`);
                    this.mergeRemoteData(remoteStudents);
                    // Force refresh visuals
                    if (typeof UI !== 'undefined') {
                        UI.updateStats();
                        UI.renderStudents();
                    }
                }
            }, (error) => {
                console.error("Sync Error:", error);
                this.updateCloudStatus('offline');
            });

            // Single Settings Listener
            CloudDB.listenForSettings(cloudSettings => {
                if (cloudSettings) {
                    const localSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
                    if (JSON.stringify(cloudSettings) !== JSON.stringify(localSettings)) {
                        console.log('☁️ Remote settings updated/synced');
                        localStorage.setItem('appSettings', JSON.stringify(cloudSettings));
                        if (typeof UI !== 'undefined') {
                            UI.applyBranding();
                            UI.populateDynamicSelects();
                        }
                    }
                }
            });

            // Real-time Templates Listener
            CloudDB.listenForTemplates(cloudTemplates => {
                if (cloudTemplates && Array.isArray(cloudTemplates)) {
                    const localTmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');
                    // CLEAN CLOUD DATA before comparison to avoid loops (cloud has pdfData, local doesn't)
                    const cleanCloud = cloudTemplates.map(t => {
                        const copy = { ...t };
                        if (copy.pdfData && copy.pdfData.length > 50000) {
                            delete copy.pdfData;
                            copy.hasLargePdf = true;
                        }
                        return copy;
                    });

                    if (JSON.stringify(cleanCloud) !== JSON.stringify(localTmpls)) {
                        console.log('☁️ Templates updated from cloud');
                        this.syncTemplatesLocally(cloudTemplates);
                    }
                }
            });
        }
    }

    async loadSettings() {
        const local = localStorage.getItem('appSettings');
        if (!local && typeof CloudDB !== 'undefined') {
            const remote = await CloudDB.getSettings();
            if (remote && Object.keys(remote).length > 0) {
                localStorage.setItem('appSettings', JSON.stringify(remote));
            }
        }
    }

    async syncNow() {
        if (!CloudDB.isReady()) {
            alert('السحابة غير متصلة');
            return;
        }
        UI.showNotification('⏳ جاري المزامنة الشاملة مع السيرفر...');
        this.updateCloudStatus('connecting');
        try {
            await CloudDB.syncCloudToLocal();
            this.updateCloudStatus('online');
            UI.showNotification('✅ تمت المزامنة بنجاح!');
        } catch (e) {
            console.error(e);
            this.updateCloudStatus('offline');
            UI.showNotification('❌ فشلت المزامنة. تحقق من الإنترنت.');
        }
    }

    async syncTemplatesLocally(cloudTemplates) {
        const updated = [];
        for (const t of cloudTemplates) {
            // Re-process to extract heavy PDF data to IndexedDB
            if (t.pdfData && t.pdfData.length > 50000 && typeof contractMgr !== 'undefined') {
                await contractMgr.savePdfToDB(t.id, t.pdfData);
                const lw = { ...t };
                delete lw.pdfData;
                lw.hasLargePdf = true;
                updated.push(lw);
            } else {
                updated.push(t);
            }
        }
        localStorage.setItem('contractTemplates', JSON.stringify(updated));
        if (typeof contractMgr !== 'undefined') contractMgr.init();
        if (typeof UI !== 'undefined' && UI.refreshData) UI.refreshData();
        if (typeof ContractUI !== 'undefined' && ContractUI.renderContracts) ContractUI.renderContracts();
    }

    updateCloudStatus(status) {
        const dot = document.getElementById('cloudStatusDot');
        const text = document.getElementById('cloudStatusText');
        const settingsBadge = document.getElementById('cloudStatusSettings');

        let color = '#94a3b8';
        let label = 'غير معروف';
        let badgeClass = 'status-badge';

        switch (status) {
            case 'online':
                color = '#10b981';
                label = 'متصل سحابياً';
                badgeClass += ' status-verified'; // Green style
                break;
            case 'connecting':
                color = '#f59e0b';
                label = 'جاري المزامنة...';
                badgeClass += ' status-pending'; // Orange style
                break;
            case 'offline':
                color = '#ef4444';
                label = 'غير متصل (محلي)';
                badgeClass += ' status-sent'; // Red/Gray style (using sent for now or custom)
                break;
            case 'disabled':
                color = '#94a3b8';
                label = 'السحابة معطلة';
                break;
        }

        // Update Navbar
        if (dot) dot.style.background = color;
        if (text) text.textContent = label;

        // Update Settings Page Badge
        if (settingsBadge) {
            settingsBadge.textContent = label;
            settingsBadge.className = badgeClass;
            // Manual override for offline/disabled colors if needed
            if (status === 'offline') settingsBadge.style.backgroundColor = '#fee2e2';
            if (status === 'offline') settingsBadge.style.color = '#991b1b';
        }
    }

    async mergeRemoteData(remoteStudents) {
        if (!remoteStudents || !Array.isArray(remoteStudents)) return;

        // FULL MIRROR SYNC: Local storage becomes an EXACT replica of the Cloud.
        // If Cloud is empty (User zeroed the platform), local becomes empty too.
        console.log(`🔄 Mirroring cloud state: ${remoteStudents.length} students found.`);

        const mirroredStudents = [];
        for (const remote of remoteStudents) {
            if (!remote || !remote.id) continue;
            // Offload images to IndexedDB during mirroring
            await this.offloadHeavyData(remote);
            mirroredStudents.push(this.cleanStudentForStorage(remote));
        }

        try {
            localStorage.setItem('students', JSON.stringify(mirroredStudents));
            if (typeof UI !== 'undefined' && UI.renderStudents) UI.renderStudents();
            if (typeof UI !== 'undefined' && UI.updateStats) UI.updateStats();
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                // Emergency cleanup if storage is full
                const stripped = mirroredStudents.map(s => this.cleanStudentForStorage(s));
                localStorage.setItem('students', JSON.stringify(stripped));
            }
        }
    }

    // Helper to move heavy fields to IndexedDB
    async offloadHeavyData(student) {
        if (typeof contractMgr === 'undefined') return;
        const heavyFields = ['signature', 'signatureData', 'idImage', 'idCardImage', 'pdfData'];
        for (const field of heavyFields) {
            if (student[field] && student[field].length > 1000) {
                await contractMgr.saveMedia(student.id, field, student[field]);
            }
        }
    }

    // Helper to remove heavy fields before localStorage
    cleanStudentForStorage(student) {
        const cleaned = { ...student };
        const heavyFields = ['signature', 'signatureData', 'idImage', 'idCardImage', 'pdfData'];
        heavyFields.forEach(f => delete cleaned[f]);
        cleaned.hasOffloadedData = true;
        return cleaned;
    }

    // Helper to re-attach heavy data for specific operations
    async hydrateStudent(student) {
        if (typeof contractMgr === 'undefined' || !student.hasOffloadedData) return student;
        const fullStudent = { ...student };
        const heavyFields = ['signature', 'signatureData', 'idImage', 'idCardImage', 'pdfData'];
        for (const field of heavyFields) {
            const data = await contractMgr.getMedia(student.id, field);
            if (data) fullStudent[field] = data;
        }
        return fullStudent;
    }

    getSettings() {
        const defaults = {
            schoolStampText: 'مدارس دانة العلوم - الإدارة',
            levels: ['الطفولة المبكرة', 'رياض أطفال', 'الابتدائية', 'المتوسطة', 'الثانوية'],
            grades: ['مستوى أول', 'مستوى ثاني', 'مستوى ثالث', 'الصف الأول', 'الصف الثاني', 'الصف الثالث', 'الصف الرابع', 'الصف الخامس', 'الصف السادس', 'الأول متوسط', 'الثاني متوسط', 'الثالث متوسط', 'الأول ثانوي', 'الثاني ثانوي', 'الثالث ثانوي'],
            adminUsername: 'admin',
            adminPassword: 'admin',
            schoolLogo: '',
            schoolPhone: '966590000000',
            serverAddress: '',
            customFields: [ // Default custom fields
                { id: 'nationalId', label: 'رقم الهوية', type: 'number' }
            ],
            nationalContractId: null, // ID for the national track contract
            diplomaContractId: null   // ID for the diploma track contract
        };
        try {
            const savedRaw = localStorage.getItem('appSettings');
            if (!savedRaw) return defaults;
            const saved = JSON.parse(savedRaw);

            // Deduplicate Levels and Grades
            if (saved.levels) saved.levels = [...new Set(saved.levels)];
            if (saved.grades) saved.grades = [...new Set(saved.grades)];

            // We no longer force National ID into customFields if it's missing.
            // This allows the user to delete "رقم الهوية" or have empty customFields.
            const settings = { ...defaults, ...saved };

            // --- Migration/Fix for numerical grades ---
            // If grades are numbers, replace them with Arabic descriptive names
            if (settings.grades && settings.grades.some(g => !isNaN(g) && g.length <= 2)) {
                console.log('🔄 Migrating numerical grades to descriptive names...');
                settings.grades = defaults.grades;
                // Only save if it's the first connection or user settings changed
                localStorage.setItem('appSettings', JSON.stringify(settings));
            }
            return settings;
        } catch (e) {
            return defaults;
        }
    }

    saveSettings(settings) {
        localStorage.setItem('appSettings', JSON.stringify(settings));
        if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            CloudDB.saveSettings(settings);
        }
    }

    async migrateLargeDataToIndexedDB() {
        console.log('📦 Starting storage quota optimization migration...');
        const students = this.getStudents(true);
        let migratedCount = 0;

        for (let i = 0; i < students.length; i++) {
            const s = students[i];
            const originalSize = JSON.stringify(s).length;

            // If student has heavy fields in localStorage, move them
            const heavyFields = ['signature', 'signatureData', 'idImage', 'idCardImage', 'pdfData'];
            let needsOffload = false;
            heavyFields.forEach(f => { if (s[f] && s[f].length > 500) needsOffload = true; });

            if (needsOffload) {
                await this.offloadHeavyData(s);
                students[i] = this.cleanStudentForStorage(s);
                migratedCount++;
            }
        }

        if (migratedCount > 0) {
            localStorage.setItem('students', JSON.stringify(students));
            console.log(`✅ Storage Optimized: Moved ${migratedCount} large student records to IndexedDB.`);
        }
    }

    getStudents(includeArchived = false) {
        const stored = localStorage.getItem('students');
        if (!stored) return [];
        try {
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) return [];

            let filtered = parsed.filter(s => s && s.id && s.studentName && s.studentName !== 'undefined');
            if (!includeArchived) {
                filtered = filtered.filter(s => !s.isArchived);
            }
            return filtered;
        } catch (e) {
            console.error('Data Parsing Error:', e);
            return [];
        }
    }

    async saveStudent(student) {
        if (!student || !student.studentName || student.studentName === 'undefined') return;

        // Ensure student has an ID BEFORE sending to the cloud
        if (!student.id) student.id = Date.now().toString();

        // 1. Send FULL data to Cloud first
        if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            CloudDB.saveStudent(student);
        }

        // 2. Offload heavy data to IndexedDB
        await this.offloadHeavyData(student);

        // 3. Save cleaned metadata to localStorage
        const students = this.getStudents(true);
        const cleaned = this.cleanStudentForStorage(student);
        const existingIndex = students.findIndex(s => String(s.id) === String(student.id));

        if (existingIndex !== -1) {
            students[existingIndex] = { ...students[existingIndex], ...cleaned };
        } else {
            if (!cleaned.id) cleaned.id = Date.now().toString();
            students.push(cleaned);
        }

        this.saveStudents(students);
        return student;
    }

    saveStudents(students) {
        // Final safety filter before writing to disk
        const clean = students.filter(s => s && s.id && s.studentName);
        localStorage.setItem('students', JSON.stringify(clean));
    }

    deleteStudent(id) {
        console.log('🗑️ Attempting to delete student with ID:', id);
        try {
            // CRITICAL: Include archived students so we don't accidentally wipe them from local storage
            const students = this.getStudents(true);
            const initialCount = students.length;
            const filtered = students.filter(s => String(s.id) !== String(id));

            if (filtered.length === initialCount) {
                console.warn('⚠️ No student found with ID:', id);
                return false;
            }

            this.saveStudents(filtered);
            if (typeof CloudDB !== 'undefined') CloudDB.deleteStudent(id);
            return true;
        } catch (error) {
            console.error('❌ Error deleting student:', error);
            return false;
        }
    }

    updateStudentStatus(id, status) {
        const students = this.getStudents(true); // Include archived for lookup safety
        const idx = students.findIndex(s => String(s.id) === String(id));
        if (idx !== -1) {
            students[idx].contractStatus = status;
            this.saveStudents(students);
            if (typeof CloudDB !== 'undefined' && CloudDB.updateContract) {
                CloudDB.updateContract(id, { contractStatus: status });
            }
            return true;
        }
        return false;
    }

    getStats() {
        const students = this.getStudents();
        return {
            total: students.length,
            signed: students.filter(s => s.contractStatus === 'signed' || s.contractStatus === 'verified').length,
            pending: students.filter(s => s.contractStatus === 'pending').length,
            sent: students.filter(s => s.contractStatus === 'sent').length
        };
    }

    migrateStudents(nextYearLabel) {
        console.log('🚀 Starting Annual Migration to:', nextYearLabel);
        const students = this.getStudents(true); // Get all including archived
        const settings = this.getSettings();
        const gradesOrder = settings.grades || [];

        const normalize = (s) => String(s || '').trim().replace(/[أإآ]/g, 'ا').toLowerCase();
        const normalizedGrades = gradesOrder.map(normalize);

        let promotedCount = 0;
        let archivedCount = 0;

        const updatedStudents = students.map(student => {
            // Only migrate active students
            if (student.isArchived) return student;

            // 1. Archive current contract if signed/verified
            if (student.contractStatus === 'signed' || student.contractStatus === 'verified') {
                if (!student.contractHistory) student.contractHistory = [];

                // Get template to save a snapshot of the fields used at the time
                const template = student.contractTemplateId ? contractMgr.getContract(student.contractTemplateId) : null;

                student.contractHistory.push({
                    contractYear: student.contractYear || '---',
                    studentGrade: student.studentGrade || '',
                    studentLevel: student.studentLevel || '',
                    contractTitle: student.contractTitle || 'عقد سجل',
                    contractContent: student.contractContent || '',
                    contractType: student.contractType || 'text',
                    pdfData: student.pdfData || (template ? template.pdfData : null),
                    pdfFields: template ? template.pdfFields : null,
                    signature: student.signature || student.signatureData || null,
                    idImage: student.idImage || student.idCardImage || null,
                    signedAt: student.signedAt || new Date().toISOString(),
                    contractStatus: student.contractStatus,
                    contractTemplateId: student.contractTemplateId || ''
                });
            }

            // 2. Promote Grade based on current grade list order
            const currentGrade = normalize(student.studentGrade);
            const currentIdx = normalizedGrades.indexOf(currentGrade);

            if (currentIdx !== -1 && currentIdx < normalizedGrades.length - 1) {
                student.studentGrade = gradesOrder[currentIdx + 1];
                promotedCount++;
            } else if (currentIdx !== -1 && currentIdx === normalizedGrades.length - 1) {
                // Graduate / Archive the student if they reached the last grade
                student.isArchived = true;
                archivedCount++;
                // Skip reset for archived students - they are done
                return student;
            } else {
                // FALLBACK: If current grade isn't in system list, we don't know where to promote.
                // We keep them in same grade but reset for new year below.
                console.warn(`Could not find promotion path for grade: "${student.studentGrade}"`);
            }

            // 3. Reset status for new year (CRITICAL: Clear all old contract data for active students)
            student.contractStatus = 'pending';
            student.contractYear = nextYearLabel || student.contractYear;
            student.signature = null;
            student.signatureData = null;
            student.idImage = null;
            student.signedAt = null;
            student.contractNo = null;
            student.idCardImage = null; // Legacy field
            student.contractTitle = null; // Force refresh on next send
            student.contractContent = null; // Force refresh on next send
            student.pdfData = null; // Force refresh on next send
            student.extraDocs = [];

            return student;
        });

        this.saveStudents(updatedStudents);

        // Final sync if cloud is ready
        if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            UI.showNotification('⏳ جاري تحديث السحابة...');
            CloudDB.syncLocalToCloud().then(success => {
                if (success) console.log('✅ Cloud Migration Sync Done');
            });
        }

        return { promotedCount, archivedCount };
    }

    async syncNow() {
        console.log('🔄 Manual Sync Starting...');
        if (typeof CloudDB === 'undefined') {
            if (typeof UI !== 'undefined' && UI.showNotification) UI.showNotification('❌ فشل: لم يتم تحميل ملف الإعدادات السحابية');
            return;
        }

        if (!CloudDB.isReady()) {
            if (typeof UI !== 'undefined' && UI.showNotification)
                UI.showNotification('⚠️ السحابة في حالة انتظار (جاري الاتصال)... تأكد من الإنترنت');
            return;
        }

        if (typeof UI !== 'undefined' && UI.showNotification) UI.showNotification('⏳ جاري جلب البيانات من السحابة... يرجى الانتظار');

        try {
            const remoteStudents = await CloudDB.getStudents();
            console.log('☁️ Sync result:', remoteStudents ? remoteStudents.length : 0, 'students');

            if (remoteStudents && Array.isArray(remoteStudents)) {
                await this.mergeRemoteData(remoteStudents);
                if (typeof UI !== 'undefined' && UI.showNotification)
                    UI.showNotification(`✅ تمت المزامنة بنجاح: تم جلب ${remoteStudents.length} طالباً`);
                if (typeof UI !== 'undefined') {
                    if (UI.refreshData) UI.refreshData();
                    if (UI.updateStats) UI.updateStats();
                }
            } else {
                if (typeof UI !== 'undefined' && UI.showNotification)
                    UI.showNotification('ℹ️ السحابة فارغة حالياً (لا توجد بيانات طلاب)');
            }
        } catch (err) {
            console.error('Detailed Manual sync error:', err);
            let technicalDetail = err.message || (typeof err === 'string' ? err : 'خطأ غير معروف');

            let friendlyError = technicalDetail;
            if (technicalDetail.includes('permission_denied')) friendlyError = 'تم رفض الوصول (Permissions Denied). تحقق من إعدادات الخادم.';
            if (technicalDetail.includes('network')) friendlyError = 'مشكلة في الشبكة. قد يكون السبب عدم ضبط وقت الجهاز بشكل صحيح.';

            if (typeof UI !== 'undefined' && UI.showNotification)
                UI.showNotification(`❌ فشل المزامنة: ${friendlyError}`);

            if (friendlyError.includes('Access Denied') || friendlyError.includes('permission')) {
                alert('⚠️ تنبيه أمني: الخادم السحابي يرفض الوصول لهذه البيانات. قد تحتاج لمراجعة إعدادات الخادم.');
            }
        }
    }
}

// Select All Contracts Checkbox (Signed Contracts Tab)
const selectAllContractsCheckbox = document.getElementById('selectAllContracts');
if (selectAllContractsCheckbox) {
    selectAllContractsCheckbox.addEventListener('change', function () {
        const checkboxes = document.querySelectorAll('.contract-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = this.checked;
        });
    });
}

// UI Management
const UI = {
    modal: document.getElementById('newStudentModal'),
    studentForm: document.getElementById('studentForm'),
    tableBody: document.getElementById('studentsTableBody'),
    currentSort: { field: 'createdAt', order: 'desc' },

    handleSelectionChange() {
        const dashboardChecks = document.querySelectorAll('#studentsTableBody .student-checkbox:checked');
        const mainChecks = document.querySelectorAll('#allStudentsTableBody .student-checkbox:checked');

        const dashBtn = document.getElementById('deleteSelectedBtn');
        const dashCount = document.getElementById('selectedCount');
        const mainBtn = document.getElementById('deleteSelectedBtnMain');
        const mainCount = document.getElementById('selectedCountMain');

        if (dashBtn && dashCount) {
            dashCount.textContent = dashboardChecks.length;
            dashBtn.style.display = dashboardChecks.length > 0 ? 'inline-flex' : 'none';
        }

        const bulkActions = document.getElementById('bulkActions');
        if (mainBtn && mainCount && bulkActions) {
            const count = mainChecks.length;
            mainCount.textContent = count;
            bulkActions.style.display = count > 0 ? 'flex' : 'none';
        }
    },

    bulkUpdateStatus(status) {
        const checks = document.querySelectorAll('.student-checkbox:checked');
        const ids = Array.from(checks).map(cb => cb.value);
        if (ids.length === 0) return;

        const statusText = status === 'sent' ? 'مرسل' : 'موثق';
        if (confirm(`هل تريد تغيير حالة ${ids.length} طلاب إلى (${statusText})؟`)) {
            ids.forEach(id => db.updateStudentStatus(id, status));
            this.renderStudents();
            this.updateStats();
            this.showNotification(`✅ تم تحديث حالة ${ids.length} طلاب`);
        }
    },

    deleteStudent(id) {
        if (confirm('هل أنت متأكد من حذف هذا الطالب نهائياً؟')) {
            db.deleteStudent(id);
            this.renderStudents();
            this.updateStats();
            this.showNotification('✅ تم حذف الطالب بنجاح');
        }
    },

    deleteSelectedStudents() {
        // Collect all checked IDs from both possible tables
        const checks = document.querySelectorAll('.student-checkbox:checked');
        const ids = Array.from(checks).map(cb => cb.value);

        if (ids.length === 0) {
            this.showNotification('⚠️ يرجى اختيار طلاب للحذف');
            return;
        }

        if (confirm(`هل أنت متأكد من حذف ${ids.length} طلاب؟`)) {
            console.log('🗑️ Bulk deleting IDs:', ids);
            ids.forEach(id => db.deleteStudent(id));
            this.renderStudents();
            this.updateStats();
            this.showNotification(`✅ تم حذف ${ids.length} طلاب بنجاح`);

            // Uncheck header checkboxes
            const headers = document.querySelectorAll('input[type="checkbox"][id^="selectAll"]');
            headers.forEach(h => h.checked = false);
        }
    },

    openModal() {
        const title = document.getElementById('modalTitle');
        if (title) title.textContent = 'تسجيل طالب جديد';

        const form = document.getElementById('studentForm');
        if (form) {
            form.reset();
            form.removeAttribute('data-editing-id');
        }

        const sendMethod = document.getElementById('sendMethod');
        if (sendMethod) sendMethod.value = 'whatsapp';

        if (document.getElementById('registrationType')) document.getElementById('registrationType').value = 'existing';
        if (document.getElementById('studentNationality')) document.getElementById('studentNationality').value = 'سعودي';

        this.renderStudentFormFields(); // Render empty fields for new student
        this.showModal();
    },

    autoSelectContract() {
        const trackSelect = document.getElementById('studentTrack');
        const contractSelect = document.getElementById('contractTemplate');
        if (!trackSelect || !contractSelect) return;

        const selectedTrack = trackSelect.value;
        if (!selectedTrack) return;

        // Ensure contracts are populated in the dropdown before selecting
        if (contractSelect.options.length <= 1) {
            this.populateDynamicSelects();
        }

        const settings = db.getSettings();
        let contractToSelect = '';

        // Resilient matching logic
        const isDiploma = selectedTrack.includes('دبلوما') || selectedTrack.includes('دبلوم') || /diploma/i.test(selectedTrack);
        const isNational = selectedTrack.includes('أهلي') || selectedTrack.includes('ثنائي') || selectedTrack.includes('عام') || /national|bilingual/i.test(selectedTrack);

        if (isDiploma) {
            contractToSelect = settings.diplomaContractId;
        } else if (isNational) {
            contractToSelect = settings.nationalContractId;
        }

        if (!contractToSelect) {
            console.warn('No contract ID mapped in settings for:', selectedTrack);
            // Don't show an annoying alert every time, just a small notice or log
            return;
        }

        // Try to select
        const option = contractSelect.querySelector(`option[value="${contractToSelect}"]`);
        if (option) {
            contractSelect.value = contractToSelect;
            this.showNotification(`✅ تم ربط العقد تلقائياً: ${option.text}`);
        } else {
            // Fallback: Re-populate and try once more if not found
            this.populateContractTemplates();
            const retryOption = contractSelect.querySelector(`option[value="${contractToSelect}"]`);
            if (retryOption) {
                contractSelect.value = contractToSelect;
            } else {
                UI.showNotification(`⚠️ تنبيه: العقد المربوط بالمسار غير متوفر حالياً.`);
            }
        }
    },

    showModal() {
        if (this.modal) {
            this.modal.classList.add('active');
            this.modal.style.display = 'flex';
        }
    },

    openImportModal() {
        const modal = document.getElementById('importModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
        }
    },

    closeImportModal() {
        const modal = document.getElementById('importModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
    },

    closeModal() {
        if (this.modal) {
            this.modal.classList.remove('active');
            this.modal.style.display = 'none';
        }
    },

    closePreviewModal() {
        const modal = document.getElementById('contractPreviewModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
    },

    updateStats() {
        if (!document.getElementById('totalStudents')) return;
        const stats = db.getStats();
        // Animate numbers
        const animateValue = (id, start, end, duration) => {
            const obj = document.getElementById(id);
            if (!obj) return;
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                obj.innerHTML = Math.floor(progress * (end - start) + start);
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            };
            window.requestAnimationFrame(step);
        };

        animateValue("totalStudents", 0, stats.total, 1000);
        animateValue("signedContracts", 0, stats.signed, 1000);
        animateValue("pendingContracts", 0, stats.pending, 1000);
        animateValue("sentContracts", 0, stats.sent, 1000);

        if (this.initCharts) this.initCharts();
    },

    charts: { stats: null, dist: null },

    initCharts() {
        const canvas1 = document.getElementById('statsChart');
        const canvas2 = document.getElementById('distributionChart');
        if (!canvas1 || !canvas2 || typeof Chart === 'undefined') return;

        const stats = db.getStats();
        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        // Cleanup existing charts
        if (this.charts.stats) this.charts.stats.destroy();
        if (this.charts.dist) this.charts.dist.destroy();

        const ctx1 = canvas1.getContext('2d');
        this.charts.stats = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: ['إجمالي الطلاب', 'موقعة', 'انتظار', 'مرسلة'],
                datasets: [{
                    label: 'العدد',
                    data: [stats.total, stats.signed, stats.pending, stats.sent],
                    backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#3b82f6'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: gridColor }, ticks: { color: textColor, precision: 0 } },
                    x: { grid: { display: false }, ticks: { color: textColor } }
                }
            }
        });

        const ctx2 = canvas2.getContext('2d');
        this.charts.dist = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: ['موقعة', 'أخرى'],
                datasets: [{
                    data: [stats.signed, Math.max(0, stats.total - stats.signed)],
                    backgroundColor: ['#10b981', '#e2e8f0'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'Cairo', size: 12 }, padding: 20 }
                    }
                }
            }
        });
    },

    renderStudents(filteredStudents = null) {
        const students = filteredStudents || db.getStudents();

        // 1. Dashboard Table (Action Needed - Pending Contracts)
        if (this.tableBody) {
            this.tableBody.innerHTML = '';
            // Filter for pending/sent contracts ONLY
            const pendingStudents = students.filter(s => s.contractStatus === 'pending' || s.contractStatus === 'sent' || !s.contractStatus);

            const displayStudents = [...pendingStudents]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5);

            if (displayStudents.length === 0) {
                this.tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #10b981; font-weight:bold;">✨ ممتاز! لا توجد عقود معلقة حالياً</td></tr>';
            } else {
                displayStudents.forEach(student => {
                    const row = document.createElement('tr');
                    row.innerHTML = this.renderRow(student, false, 'dash'); // Prefix 'dash' prevents ID collision
                    this.tableBody.appendChild(row);
                });
            }
        }

        // 2. All Students Table
        const allTableBody = document.getElementById('allStudentsTableBody');
        if (allTableBody) {
            allTableBody.innerHTML = '';
            if (students.length === 0) {
                allTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">لا يوجد طلاب مسجلين</td></tr>';
            } else {
                students.forEach(student => {
                    const row = document.createElement('tr');
                    row.innerHTML = this.renderRow(student, true, 'all'); // Prefix 'all' prevents ID collision
                    allTableBody.appendChild(row);
                });
            }
        }

        // Update counts
        const filteredCountEl = document.getElementById('filteredCount');
        if (filteredCountEl) filteredCountEl.textContent = students.length;

        // Update selection buttons status
        this.handleSelectionChange();

        // 3. Contracts Page Table
        this.renderSignedContracts();
    },

    renderSignedContracts(searchTerm = '') {
        const contractsTableBody = document.getElementById('signedContractsTableBody');
        if (!contractsTableBody) return;

        let students = db.getStudents().filter(s => s.contractStatus === 'signed' || s.contractStatus === 'verified');

        // Apply search filter
        if (searchTerm) {
            students = students.filter(s =>
                s.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.parentName?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        contractsTableBody.innerHTML = '';

        if (students.length === 0) {
            const message = searchTerm ? 'لا توجد نتائج للبحث' : 'لا توجد عقود موثقة حالياً';
            contractsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">${message}</td></tr>`;
            return;
        }

        students.sort((a, b) => new Date(b.signedAt || 0) - new Date(a.signedAt || 0)).forEach(student => {
            const row = document.createElement('tr');
            const statusBadge = this.getStatusBadge(student.contractStatus);
            const date = student.signedAt ? new Date(student.signedAt).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : '-';

            row.innerHTML = `
                <td><input type="checkbox" class="contract-checkbox" value="${student.id}"></td>
                <td><div style="font-weight: bold;">${student.studentName}</div></td>
                <td>${student.parentName || '-'}</td>
                <td>${date}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                        ${student.contractStatus === 'signed' ? `
                            <button class="btn-icon" onclick="markAsSigned('${student.id}')" title="توثيق الآن" style="color: #38b2ac;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            </button>` : ''}
                        <button class="btn-icon" onclick="UI.previewContract('${student.id}')" title="معاينة" style="color: #3b82f6;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                        <button class="btn-icon" onclick="UI.downloadContractPdf('${student.id}')" title="تحميل" style="color: #f59e0b;">
                             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </button>
                    </div>
                </td>
            `;
            contractsTableBody.appendChild(row);
        });
    },

    renderRow(student, withCheckbox, prefix = 'all') {
        const statusBadge = this.getStatusBadge(student.contractStatus);

        // Fix for Checkbox column
        const checkboxHtml = withCheckbox ?
            `<td><input type="checkbox" class="student-checkbox" value="${student.id}" onchange="UI.handleSelectionChange()"></td>` :
            `<td>-</td>`;

        // Verification Button (Green) - only for 'signed' status
        const verifyBtn = student.contractStatus === 'signed' ? `
            <button class="btn-icon" onclick="markAsSigned('${student.id}')" title="تأكيد الاستلام والتوثيق" style="color: #38b2ac;">
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            </button>
        ` : '';

        // Determine visibility of icons based on status
        const isNotSigned = student.contractStatus === 'pending' || student.contractStatus === 'sent';
        const isSigned = student.contractStatus === 'signed' || student.contractStatus === 'verified';

        // Column Logic:
        // Dashboard (withCheckbox=false): Name & Level combined | 7 Columns Total
        // All Students (withCheckbox=true): Name separate, Level separate | 8 Columns Total

        const nameCell = withCheckbox ?
            `<td><div style="font-weight: bold;">${student.studentName}</div></td>` :
            `<td>
                <div style="font-weight: bold;">${student.studentName}</div>
                <div style="font-size: 0.75rem; color: #718096;">${student.studentLevel || '-'} (${student.studentGrade || '-'})</div>
            </td>`;

        const levelCell = withCheckbox ?
            `<td>${student.studentLevel || '-'} (${student.studentGrade || '-'})</td>` :
            '';

        const menuId = `action-menu-${prefix}-${student.id}`;
        return `
            ${checkboxHtml}
            <td><div style="font-weight: bold;">${student.studentName}</div></td>
            <td>${student.customFields?.studentTrack || student.studentTrack || '-'}</td>
            <td>${student.studentLevel || '-'}</td>
            <td>${student.studentGrade || '-'}</td>
            <td>${student.customFields?.nationalId || '-'}</td>
            <td>${student.parentName || '-'}</td>
            <td style="font-size: 0.85rem;">${student.parentEmail || '-'}</td>
            <td>${student.customFields?.parentNationalId || student.customFields?.motherNationalId || '-'}</td>
            <td dir="ltr" style="font-size: 0.85rem;">${student.parentWhatsapp || '-'}</td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-group">
                    ${(() => {
                // Determine Primary Action
                if (student.contractStatus === 'pending') {
                    return `<button class="action-btn-main send" onclick="UI.sendContract('${student.id}')" title="إرسال العقد">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                إرسال
                            </button>`;
                } else if (student.contractStatus === 'sent') {
                    return `<button class="action-btn-main remind" onclick="UI.remindParent('${student.id}')" title="إرسال تذكير">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                                تذكير
                            </button>`;
                } else if (student.contractStatus === 'signed') {
                    return `<button class="action-btn-main verify" onclick="UI.markAsSigned('${student.id}')" title="توثيق العقد">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                توثيق
                            </button>`;
                } else {
                    // Verified
                    return `<button class="action-btn-main verify" onclick="UI.downloadContractPdf('${student.id}')" title="تحميل">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                تحميل
                            </button>`;
                }
            })()}
                    
                    <div style="position: relative;">
                        <button class="action-dropdown-toggle" onclick="UI.toggleActionMenu(event, '${student.id}', '${prefix}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <div id="${menuId}" class="action-dropdown-menu">
                            <button class="action-dropdown-item" onclick="UI.editStudent('${student.id}')">
                                <span style="width:20px">✏️</span> تعديل
                            </button>
                            
                            ${student.contractStatus !== 'signed' && student.contractStatus !== 'verified' ? `
                            <button class="action-dropdown-item" onclick="UI.copyContractLink('${student.id}')">
                                <span style="width:20px">🔗</span> نسخ الرابط
                            </button>
                            ` : ''}

                            ${student.contractStatus === 'signed' || student.contractStatus === 'verified' ? `
                            <button class="action-dropdown-item" onclick="UI.previewContract('${student.id}')">
                                <span style="width:20px">👁️</span> معاينة
                            </button>
                            <button class="action-dropdown-item" onclick="UI.deleteSignedContent('${student.id}')" style="color:#d97706">
                                <span style="width:20px">↩️</span> إلغاء التوقيع
                            </button>
                            ` : ''}

                            <button class="action-dropdown-item" onclick="UI.viewStudentHistory('${student.id}')">
                                <span style="width:20px">📜</span> سجل العقود
                            </button>
                            
                            <div style="border-top:1px solid #f1f5f9; margin:4px 0;"></div>
                            
                            <button class="action-dropdown-item delete" onclick="UI.deleteStudent('${student.id}')">
                                <span style="width:20px">🗑️</span> حذف
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        `;
    },

    toggleActionMenu(event, id, prefix) {
        event.stopPropagation();
        const menuId = `action-menu-${prefix}-${id}`;
        const menu = document.getElementById(menuId);
        if (!menu) return;

        const wasActive = menu.classList.contains('active');

        // Close all first
        document.querySelectorAll('.action-dropdown-menu').forEach(m => {
            m.classList.remove('active');
            m.style.display = 'none';
        });

        if (!wasActive) {
            const btn = event.currentTarget;
            const rect = btn.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;

            // 1. Show momentarily to calculate dimensions
            menu.classList.add('active'); // Use class first
            menu.style.display = 'flex';
            menu.style.visibility = 'hidden';
            menu.style.position = 'fixed';

            // 2. Calculate vertical position (Smart Direction)
            const menuHeight = menu.offsetHeight || 200;
            const spaceBelow = window.innerHeight - rect.bottom;

            // Check if we should open UPWARDS
            if (spaceBelow < menuHeight && rect.top > menuHeight) {
                menu.style.top = (rect.top - menuHeight - 5) + 'px';
                menu.style.transformOrigin = 'bottom right';
            } else {
                // Open Downwards (Default)
                menu.style.top = (rect.bottom + 5) + 'px';
                menu.style.transformOrigin = 'top right';
            }

            // 3. Calculate horizontal position
            if (rect.left < 250) {
                // Too close to left edge? Open towards right
                menu.style.left = rect.left + 'px';
                menu.style.right = 'auto';
            } else {
                // Default: Open towards left (align right edge)
                const rightDist = viewportWidth - rect.right;
                menu.style.left = 'auto';
                menu.style.right = rightDist + 'px';
            }

            // 4. Finalize display
            menu.style.zIndex = '99999999';
            menu.style.visibility = 'visible';
            // Line 1020: menu.classList.add('active'); // Already added above
        }
    },

    deleteSignedContent(id) {
        if (confirm('هل أنت متأكد من إلغاء توقيع هذا الطالب؟ سيتم مسح بيانات التوقيع وإعادة الحالة إلى "قيد الانتظار".')) {
            const student = db.getStudents().find(s => s.id === id);
            if (student) {
                student.contractStatus = 'pending';
                student.signature = null;
                student.signedAt = null;
                student.contractNo = null;
                student.idImage = null;
                db.saveStudent(student);
                this.renderStudents();
                this.updateStats();
                this.showNotification('✅ تم إلغاء التوقيع بنجاح');
            }
        }
    },

    getStatusBadge(status) {
        const badges = {
            'pending': '<span class="status-badge status-pending">قيد الانتظار</span>',
            'sent': '<span class="status-badge status-sent">تم الإرسال</span>',
            'signed': '<span class="status-badge status-signed">تم التوقيع</span>',
            'verified': '<span class="status-badge status-verified">موثق</span>'
        };
        return badges[status] || '<span class="status-badge">غير معروف</span>';
    },
    async generateContractLink(student) {
        if (!student) throw new Error("بيانات الطالب غير متوفرة");

        const settings = (typeof db !== 'undefined' && db.getSettings) ? db.getSettings() : {};

        // DYNAMIC DOMAIN DETECTION
        let basePath = settings.serverAddress;
        if (!basePath || basePath.trim() === "") {
            basePath = window.location.origin + window.location.pathname.replace('index.html', '').replace(/\/$/, '');
        }

        // Ensure protocol
        if (basePath && !basePath.includes('://') && !basePath.startsWith('file:') && !basePath.startsWith('http')) {
            basePath = 'https://' + basePath;
        }

        basePath = basePath.replace(/\/$/, '');
        const isLocal = !settings.serverAddress && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:');

        // Get template
        const templateId = student.contractTemplateId;
        let template = null;
        if (typeof contractMgr !== 'undefined') {
            template = contractMgr.getContract(templateId) || contractMgr.getDefaultContract();
            if (template && template.hasLargePdf && !template.pdfData) {
                try {
                    template.pdfData = await contractMgr.getPdfFromDB(template.id);
                } catch (e) {
                    console.warn("Could not load PDF data from IndexedDB:", e);
                }
            }
        } else {
            const tmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');
            template = tmpls.find(c => c.id === templateId) || tmpls.find(c => c.isDefault) || tmpls[0];
        }

        // Cloud sync fallback
        if (template && typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            const updateData = {
                contractTitle: template.title || 'عقد',
                contractContent: template.content || '',
                contractType: template.type || 'text',
                contractTemplateId: template.id,
                contractStatus: student.contractStatus || 'pending'
            };
            if (template.type === 'pdf_template') {
                if (template.pdfData) updateData.pdfData = template.pdfData;
                if (template.pdfFields) updateData.pdfFields = template.pdfFields;
            }
            if (CloudDB.updateContract) {
                CloudDB.updateContract(student.id, updateData);
            }
        }

        const dataToCompress = {
            i: student.id,
            s: student.studentName,
            l: student.studentLevel || '',
            g: student.studentGrade || '',
            p: student.parentName || '',
            e: student.parentEmail || '',
            w: student.parentWhatsapp || '',
            y: student.contractYear || new Date().getFullYear().toString(),
            tid: student.contractTemplateId || '',
            nid: student.nationalId || '',
            pnid: student.customFields?.parentNationalId || '',
            adr: student.address || student.customFields?.address || '',
            nat: student.nationality || student.studentNationality || student.customFields?.nationality || '',
            rt: student.registrationType || 'existing',
            tr: student.customFields?.studentTrack || student.studentTrack || ''
        };

        if (template && template.title) {
            dataToCompress.t = template.title;
            if (template.type !== 'pdf_template' && template.content) {
                dataToCompress.c = template.content;
            }
        }

        if (typeof LZString === 'undefined') {
            throw new Error("مكتبة ضغط الروابط (LZString) غير محملة. يرجى تحديث الصفحة.");
        }

        const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(dataToCompress));
        const link = `${basePath}/contract.html?id=${student.id}&c=${compressed}`;

        return { link, isLocal, isTooLong: link.length > 4050 };
    },

    async copyContractLink(id) {
        const student = db.getStudents().find(s => String(s.id) === String(id));
        if (!student) return;

        this.showNotification('⏳ جاري تجهيز الرابط...');
        try {
            const { link, isLocal, isTooLong } = await this.generateContractLink(student).catch(err => {
                throw err;
            });

            if (isLocal) {
                this.showNotification('⚠️ تنبيه: أنت تستخدم رابطاً محلياً، لن يفتح على أجهزة أخرى.');
            }

            if (isTooLong) {
                alert('⚠️ تنبيه: نص العقد طويل جداً وقد لا يعمل الرابط بشكل سليم على بعض الهواتف.');
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(() => {
                    this.showNotification('✅ تم نسخ رابط العقد!');
                }).catch(() => {
                    this.fallbackCopyLink(link);
                });
            } else {
                this.fallbackCopyLink(link);
            }
        } catch (err) {
            console.error(err);
            alert(`❌ فشل تجهيز الرابط: ${err.message || 'خطأ غير معروف'}`);
        }
    },

    fallbackCopyLink(link) {
        const el = document.createElement('textarea');
        el.value = link;
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        this.showNotification('✅ تم نسخ الرابط!');
    },

    // sendContract is defined later in the file with more features

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },

    showPermanentError(title, message) {
        let errorBanner = document.getElementById('permanentErrorBanner');
        if (!errorBanner) {
            errorBanner = document.createElement('div');
            errorBanner.id = 'permanentErrorBanner';
            errorBanner.style.cssText = `
                background: #fef2f2;
                color: #991b1b;
                padding: 1rem;
                border-bottom: 4px solid #ef4444;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                z-index: 100000;
                text-align: center;
                font-family: 'Cairo', sans-serif;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            document.body.prepend(errorBanner);
        }
        errorBanner.innerHTML = `
            <div style="position: relative; max-width: 800px; margin: 0 auto; padding-right: 30px;">
                <button onclick="this.parentElement.parentElement.style.display='none'" style="position: absolute; right: -10px; top: -5px; background: none; border: none; font-size: 24px; cursor: pointer; color: #991b1b;">&times;</button>
                <h3 style="margin: 0 0 0.2rem 0; font-size: 1.1rem; font-weight: bold;">${title}</h3>
                <p style="margin: 0; font-size: 0.85rem; opacity: 0.9;">${message}</p>
            </div>
        `;
        errorBanner.style.display = 'block';
    },
    async downloadContractPdf(id, providedStudent = null) {
        try {
            let student = providedStudent;
            if (!student) {
                const students = db.getStudents(true);
                student = students.find(s => String(s.id) === String(id));
            }
            if (!student) throw new Error("الطالب غير موجود");

            if (typeof UI.showNotification === 'function') UI.showNotification('⏳ جاري تحضير ملف PDF...');

            // HYDRATE: Load signatures/images from IndexedDB before generating PDF
            student = await db.hydrateStudent(student);

            const templateId = student.contractTemplateId;
            let template = (typeof contractMgr !== 'undefined')
                ? contractMgr.getContract(templateId) || contractMgr.getDefaultContract()
                : null;

            if (!template) {
                const tmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');
                template = tmpls.find(c => c.id === templateId) || tmpls.find(c => c.isDefault) || tmpls[0];
            }

            if (!template) throw new Error("قالب العقد غير موجود");

            if (template.type === 'pdf_template') {
                const pdfBytes = await contractMgr.generatePdfFromTemplate(template, student);
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const link = document.createElement('a');
                link.href = window.URL.createObjectURL(blob);
                link.download = `عقد_${student.studentName}.pdf`;
                link.click();
                if (typeof UI.showNotification === 'function') UI.showNotification('✅ تم تحميل الملف');
                return;
            }

            // HTML to PDF (Standard)
            const overlay = document.createElement('div');
            overlay.className = 'pdf-render-overlay';
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:white; z-index:100000; overflow-y:auto; padding:40px 0; direction:rtl; text-align:center;';
            overlay.innerHTML = `
                <div style="margin-bottom:20px; font-weight:bold; color:#1e3a8a; font-family:Cairo, sans-serif; font-size:18px;">جاري استخراج ملف PDF...</div>
                <div id="capture-render-area" style="background:white; pointer-events:none; direction:rtl; text-align:right; display:inline-block; width:210mm; min-height:297mm; padding:20mm; box-shadow:0 0 10px rgba(0,0,0,0.1);">
                    ${this.getContractSummaryHTML(student)}
                </div>
            `;
            document.body.appendChild(overlay);

            const captureArea = overlay.querySelector('#capture-render-area');
            const opt = {
                margin: [15, 15, 15, 15],
                filename: `عقد_${student.studentName}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };

            setTimeout(() => {
                html2pdf().from(captureArea).set(opt).toPdf().get('pdf').then((pdf) => {
                    const totalPages = pdf.internal.getNumberOfPages();
                    for (let i = 1; i <= totalPages; i++) {
                        pdf.setPage(i);
                        pdf.setDrawColor(30, 58, 138);
                        pdf.setLineWidth(0.5); pdf.rect(5, 5, 200, 287);
                        pdf.setLineWidth(1.5); pdf.rect(7, 7, 196, 283);
                    }
                }).save().then(() => {
                    document.body.removeChild(overlay);
                    this.showNotification('✅ تم تحميل العقد بنجاح');
                }).catch(err => {
                    console.error("PDF Error:", err);
                    document.body.removeChild(overlay);
                    alert("فشل التحميل التلقائي. يرجى تجربة خيار الطباعة.");
                });
            }, 2500);

        } catch (err) {
            console.error("Download Error:", err);
            alert("حدث خطأ أثناء تحميل ملف PDF: " + err.message);
        }
    },

    async generateContractPdfBlob(student) {
        // Similar to downloadContractPdf but returns Blob for ZIP bundling

        // HYDRATE: Load signatures/images from IndexedDB before generating PDF
        student = await db.hydrateStudent(student);

        const templateId = student.contractTemplateId;
        const template = templateId ? contractMgr.getContract(templateId) : contractMgr.getDefaultContract();

        if (template && template.type === 'pdf_template') {
            const pdfBytes = await contractMgr.generatePdfFromTemplate(template, student);
            return new Blob([pdfBytes], { type: 'application/pdf' });
        }

        // Create temporary container (visible but transparent for proper rendering)
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '794px';
        container.style.direction = 'rtl';
        container.style.zIndex = '-9999';
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        container.style.background = 'white';
        container.innerHTML = this.getContractSummaryHTML(student);
        document.body.appendChild(container);

        const opt = {
            margin: [15, 15, 15, 15],
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                scrollY: 0,
                scrollX: 0,
                width: 794,
                windowWidth: 794,
                backgroundColor: '#ffffff',
                letterRendering: true,
                onclone: function (clonedDoc) {
                    // Ensure cloned content is visible
                    clonedDoc.body.style.visibility = 'visible';
                }
            },
            jsPDF: {
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait',
                compress: true
            },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        return new Promise((resolve, reject) => {
            // Wait for images to load then generate PDF
            const images = container.querySelectorAll('img');
            const imagePromises = Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(r => {
                    img.onload = r;
                    img.onerror = r;
                });
            });

            Promise.all(imagePromises).then(() => {
                // Additional wait for fonts and rendering
                setTimeout(async () => {
                    try {
                        const pdf = await html2pdf().from(container).set(opt).toPdf().get('pdf');

                        // Add decorative borders
                        const totalPages = pdf.internal.getNumberOfPages();
                        for (let i = 1; i <= totalPages; i++) {
                            pdf.setPage(i);
                            pdf.setDrawColor(30, 58, 138);
                            pdf.setLineWidth(0.5);
                            pdf.rect(5, 5, 200, 287);
                            pdf.setLineWidth(1.5);
                            pdf.rect(7, 7, 196, 283);
                        }

                        const blob = pdf.output('blob');
                        document.body.removeChild(container);
                        resolve(blob);
                    } catch (err) {
                        document.body.removeChild(container);
                        reject(err);
                    }
                }, 500);
            });
        });
    },

    // Advanced Arabic Text Processor (Matching contract.js)
    fixArabic: (text) => {
        if (!text) return "";
        try {
            let str = String(text).trim();
            const hasArabic = /[\u0600-\u06FF]/.test(str);
            if (!hasArabic) return str;

            const Reshaper = (typeof ArabicReshaper !== 'undefined' ? ArabicReshaper : window.ArabicReshaper);
            if (Reshaper) {
                if (typeof Reshaper.convertArabic === 'function') str = Reshaper.convertArabic(str);
                else if (typeof Reshaper.reshape === 'function') str = Reshaper.reshape(str);
            }
            return str; // NO REVERSAL
        } catch (e) {
            console.error("Arabic fix error:", e);
            return text;
        }
    },

    getContractSummaryHTML(studentData) { // Renamed student to studentData for clarity with new mapping
        const settings = db.getSettings();
        const stampText = settings.schoolStampText || 'الإدارة';
        const schoolLogo = settings.schoolLogo || 'assets/logo.png';
        const schoolPhone = settings.schoolPhone || '---';
        const hasSignature = !!studentData.signature;
        const hasIdImage = !!studentData.idImage;
        const contractNo = studentData.contractNo || 'CON-ADMIN';

        // Fetch Template Content
        const templateId = studentData.contractTemplateId;
        let template = null;
        if (typeof contractMgr !== 'undefined') {
            template = contractMgr.getContract(templateId) || contractMgr.getDefaultContract();
        } else {
            const tmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');
            template = tmpls.find(c => c.id === templateId) || tmpls.find(c => c.isDefault);
        }

        let contractContent = 'نص العقد غير متوفر حالياً';
        let contractTitle = 'عقد تسجيل إلكتروني';

        if (template) {
            contractTitle = template.title;
            contractContent = (typeof contractMgr !== 'undefined')
                ? contractMgr.replaceVariables(template.content, studentData) // Use studentData here
                : template.content;
        }

        // Unified Variable Mapping for HTML (No reversal for Browser)
        const cleanVar = (v) => v ? v.replace(/[{}]/g, '').replace(/[ _]/g, '') : '';
        const foundVars = contractContent.match(/{[^}]+}/g) || [];
        foundVars.forEach(v => {
            const target = cleanVar(v);
            let text = "";

            // Comprehensive Field Mapping
            if (target === 'اسمالطالب' || target === 'اسمالطالبه') text = studentData.studentName || '';
            else if (target === 'اسموليالامر') text = studentData.parentName || '';
            else if (target === 'المسار') text = studentData.customFields?.studentTrack || studentData.studentTrack || '';
            else if (target === 'الصف' || target === 'الصفالدراسي') text = studentData.studentGrade || studentData.customFields?.studentGrade || '';
            else if (target === 'المرحلة' || target === 'المرحله' || target === 'المرحلةالدراسية' || target === 'المرحلهالدراسيه' || target === 'مرحلة') text = studentData.studentLevel || studentData.customFields?.studentLevel || '';
            else if (target === 'السنةالدراسية' || target === 'السنهالدراسيه') text = studentData.customFields?.contractYear || studentData.contractYear || '';
            else if (target === 'البريدالالكتروني' || target === 'الايميل') text = studentData.parentEmail || '';
            else if (target === 'هويةالطالب' || target === 'رقمهويةالطالب' || target === 'الرقمالقومي' || target === 'رقمهوية' || target === 'رقمالهوية')
                text = studentData.customFields?.nationalId || studentData.nationalId || '';
            else if (target === 'هويةوليالأمر' || target === 'رقمهويةوليالأمر' || target === 'هويةوليالامر' || target === 'رقمهويةوليالامر')
                text = studentData.customFields?.parentNationalId || '';
            else if (target === 'جوالوليالأمر' || target === 'رقمجوالوليالأمر' || target === 'رقمجوالوليالامر' || target === 'رقمواتساب')
                text = studentData.parentWhatsapp || '';
            else if (target === 'العنوان') text = studentData.address || studentData.customFields?.address || '';
            else if (target === 'الجنسية') text = studentData.nationality || studentData.customFields?.nationality || '';
            else if (target === 'التاريخ') {
                const now = new Date();
                const d = now.getDate().toString().padStart(2, '0');
                const m = (now.getMonth() + 1).toString().padStart(2, '0');
                const y = now.getFullYear();
                // For HTML based PDF, a span with dir="ltr" is most reliable
                text = `<span dir="ltr" style="unicode-bidi:isolate;">${d}/${m}/${y}</span>`;
            }

            const fixed = this.fixArabic(text); // Apply fixArabic
            if (fixed) contractContent = contractContent.replace(v, fixed);
            else if (text === '') contractContent = contractContent.replace(v, ''); // Replace with empty if intentionally empty
        });

        const stampImage = settings.stampImage || window.SCHOOL_STAMP_IMAGE;
        const stampHtml = stampImage
            ? `<div style="text-align:center; position:relative; z-index:5;"><img src="${stampImage}" style="height:110px; width:auto; max-width:150px; opacity:0.85; transform:rotate(-2deg);"></div>`
            : `<div style="width:100px; height:100px; border:3px solid #2563eb; border-radius:50%; display:flex; align-items:center; justify-content:center; position:relative; color:#2563eb; font-weight:900; transform:rotate(-15deg); background:rgba(37,99,235,0.03); margin:0 auto;"><div style="position:absolute; width:90%; height:90%; border:1px solid #2563eb; border-radius:50%;"></div><div style="font-size:11px; text-align:center; max-width:80%; line-height:1.2;">${stampText}</div></div>`;

        const idCardSection = hasIdImage ? `<img src="${studentData.idImage || studentData.idCardImage}" style="max-height:180px; max-width:90%; border:1px solid #ddd; padding:2px; border-radius:4px;">` : '';

        return `
            <div style="direction:rtl; font-family:'Cairo', sans-serif; background:white; padding:5mm 10mm; width:100%; box-sizing:border-box; color:#1a202c;">
                <table style="width:100%; border-bottom:2px solid #1e3a8a; margin-bottom:40px; padding-bottom:20px;">
                    <tr>
                        <td style="text-align:right; width:33%;">
                            <p style="font-weight:bold; margin:0; font-size:16px;">${settings.schoolName || 'مدارس دانة العلوم'}</p>
                            <p style="font-size:12px; margin:5px 0 0;">جوال: ${schoolPhone}</p>
                        </td>
                        <td style="text-align:center; width:34%;"><img src="${schoolLogo}" style="height:80px; width:auto;"></td>
                        <td style="text-align:left; width:33%;">
                            <p style="font-weight:bold; color:#1e3a8a; font-size:20px; margin:0;">${contractTitle}</p>
                            <p style="font-family:monospace; font-size:14px; margin:5px 0 0; color:#718096;">${contractNo}</p>
                        </td>
                    </tr>
                </table>

                <!-- Contract Content -->
                <div style="font-size:14px; line-height:1.8; margin-bottom:30px; text-align:justify; white-space:pre-wrap;">${contractContent}</div>

                <!-- Signatures & ID Card -->
                <div style="page-break-inside: avoid; border: 1px solid #edf2f7; border-radius: 12px; padding: 15px; background: #fff; margin-top: 20px;">
                    <table style="width:100%;">
                        <tr>
                            <td style="text-align:center; width:50%; vertical-align:bottom;">
                                <p style="font-weight:bold; margin-bottom:10px; color:#2d3748; font-size:13px;">الختم والاعتماد</p>
                                ${stampHtml}
                            </td>
                            <td style="text-align:center; width:50%; vertical-align:bottom;">
                                <p style="font-weight:bold; margin-bottom:10px; color:#2d3748; font-size:13px;">توقيع ولي الأمر</p>
                                ${hasSignature ? `<img src="${studentData.signature}" style="max-height:80px; max-width:200px;">` : '<div style="height:80px; display:flex; align-items:center; justify-content:center; color:#cbd5e0;">................</div>'}
                            </td>
                        </tr>
                    </table>
                    ${idCardSection ? `
                    <div style="margin-top:15px; border-top:1px dashed #e2e8f0; padding-top:10px; text-align:center; page-break-before:always;">
                        <p style="margin:0 0 5px; font-weight:bold; font-size:12px;">صورة الهوية</p>
                        ${idCardSection}
                    </div>` : ''}
                    
                    ${(() => {
                let html = '';
                let docs = [...(studentData.extraDocs || [])];
                // Fallback for old fields to ensure no data loss
                if (studentData.birthCertImage && !docs.includes(studentData.birthCertImage)) docs.push(studentData.birthCertImage);
                if (studentData.passportImage && !docs.includes(studentData.passportImage)) docs.push(studentData.passportImage);

                docs.forEach((doc, idx) => {
                    html += `
                            <div style="margin-top:15px; border-top:1px dashed #e2e8f0; padding-top:10px; text-align:center; page-break-before:always;">
                                <p style="margin:0 0 5px; font-weight:bold; font-size:12px;">مستند إضافي (${idx + 1})</p>
                                <img src="${doc}" style="max-height:850px; max-width:95%; border:1px solid #edf2f7; border-radius:8px;">
                            </div>`;
                });
                return html;
            })()}
                </div>
            </div>`;
    },

    async previewContract(id) {
        try {
            if (typeof UI !== 'undefined' && UI.showNotification) {
                UI.showNotification('⏳ جاري جلب أحدث بيانات العقد من السيرفر...');
            }

            const students = db.getStudents(true);
            let student = students.find(s => String(s.id) === String(id));

            // جلب أحدث بيانات (خصوصاً التوقيع) من السيرفر قبل المعاينة
            if (typeof CloudDB !== 'undefined' && typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured) {
                try {
                    const cloudStudent = await CloudDB.getStudent(id);
                    if (cloudStudent) {
                        student = { ...student, ...cloudStudent };
                    }
                } catch (e) { console.warn("Could not fetch latest for preview", e); }
            }

            if (!student) throw new Error("الطالب غير موجود");

            // HYDRATE
            student = await db.hydrateStudent(student);

            const templateId = student.contractTemplateId;
            let template = (typeof contractMgr !== 'undefined')
                ? contractMgr.getContract(templateId) || contractMgr.getDefaultContract()
                : null;

            if (!template) {
                const tmpls = JSON.parse(localStorage.getItem('contractTemplates') || '[]');
                template = tmpls.find(c => c.id === templateId) || tmpls.find(c => c.isDefault) || tmpls[0];
            }

            if (!template) throw new Error("قالب العقد غير موجود");

            if (template.type === 'pdf_template') {
                if (typeof UI !== 'undefined' && UI.showNotification) UI.showNotification('جاري تحضير المعاينة...');
                const pdfBytes = await contractMgr.generatePdfFromTemplate(template, student);
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                window.open(window.URL.createObjectURL(blob), '_blank');
                return;
            }

            // HTML Preview
            // HYDRATE before preview
            student = await db.hydrateStudent(student);

            const html = this.getContractSummaryHTML(student);
            const w = window.open('', '_blank');
            if (w) {
                w.document.write(`
                    <html><head><title>معاينة - ${student.studentName}</title>
                    <style>
                        body { background: #cbd5e0; display: flex; justify-content: center; padding: 2cm 0; margin: 0; direction: rtl; font-family: 'Cairo', sans-serif; }
                        .preview-wrap { background: white; box-shadow: 0 0 20px rgba(0,0,0,0.2); width: 210mm; min-height: 297mm; }
                    </style>
                    </head>
                    <body><div class="preview-wrap">${html}</div></body></html>
                `);
                w.document.close();
            }
        } catch (err) {
            console.error("Preview Error:", err);
            alert("فشلت المعاينة: " + err.message);
        }
    },



    async sendContract(id) {
        const students = db.getStudents();
        const student = students.find(s => String(s.id) === String(id));
        if (!student) return;

        // EMERGENCY: Open WhatsApp blank immediately to bypass popup blockers on mobile
        // Many mobile browsers block window.open if it's not immediately after a click (async await breaks this)
        const waWindow = window.open('', '_blank');
        if (waWindow) {
            waWindow.document.write('<html><head><title>جاري التحويل...</title><style>body{font-family:Cairo,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f0f2f5;color:#128c7e;}</style></head><body><div style="text-align:center;"><h2>⏳ جاري تحضير العقد...</h2><p>سيتم فتح واتساب تلقائياً خلال لحظات</p></div></body></html>');
        }

        try {
            const settings = db.getSettings();
            this.showNotification('⏳ جاري تحضير الرابط والمزامنة...');

            const { link, isLocal, isTooLong } = await this.generateContractLink(student).catch(err => {
                if (waWindow) waWindow.close();
                throw err;
            });

            const msg = `* عقد تسجيل إلكتروني - مدارس دانة العلوم * 📝

مرحباً ${student.parentName || ''},
يرجى الاطلاع على عقد التسجيل الخاص بالطالب / ة: * ${student.studentName} *

للتعميد والتوقيع، يرجى الضغط على الرابط التالي:
🔗 اضغط هنا للتوقيع 🔗
${link}

مع تحيات،
* مدارس دانة العلوم * `;

            const url = `https://wa.me/${student.parentWhatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg)}`;

            if (waWindow) {
                waWindow.location.href = url;
            } else {
                // Fallback if window was blocked initially
                window.open(url, '_blank');
            }

            // Sync Status
            if (student.contractStatus === 'pending') {
                db.updateStudentStatus(id, 'sent');
                this.updateStats();
                this.renderStudents();
            }
        } catch (err) {
            console.error(err);
            if (waWindow) waWindow.close();
            alert(`❌ فشل تحضير الرابط: ${err.message || 'يرجى التأكد من اتصال الإنترنت'}`);
        }
    },

    editStudent(id) {
        console.log('📝 Editing student:', id);
        // Populate modal
        const students = db.getStudents();
        const student = students.find(s => String(s.id) === String(id));
        if (!student) {
            console.error('❌ Student not found for editing:', id);
            return;
        }

        const title = document.getElementById('modalTitle');
        if (title) title.textContent = 'تعديل بيانات الطالب';

        document.getElementById('studentName').value = student.studentName || '';
        document.getElementById('parentName').value = student.parentName || '';
        document.getElementById('studentGrade').value = student.studentGrade || '';
        document.getElementById('studentLevel').value = student.studentLevel || '';
        document.getElementById('parentWhatsapp').value = student.parentWhatsapp || '';
        document.getElementById('parentEmail').value = student.parentEmail || '';
        if (document.getElementById('explicitNationalId')) {
            document.getElementById('explicitNationalId').value = student.customFields?.nationalId || '';
        }
        if (document.getElementById('parentNationalId')) {
            document.getElementById('parentNationalId').value = student.customFields?.parentNationalId || '';
        }
        if (document.getElementById('studentTrack')) {
            document.getElementById('studentTrack').value = student.customFields?.studentTrack || student.studentTrack || '';
        }
        if (document.getElementById('contractTemplate')) {
            document.getElementById('contractTemplate').value = student.contractTemplateId || '';
        }
        if (document.getElementById('registrationType')) {
            document.getElementById('registrationType').value = student.registrationType || 'existing';
        }
        if (document.getElementById('studentNationality')) {
            document.getElementById('studentNationality').value = student.studentNationality || 'سعودي';
        }
        if (document.getElementById('sendMethod')) {
            document.getElementById('sendMethod').value = student.sendMethod || 'whatsapp';
        }

        // Render Custom Fields
        this.renderStudentFormFields(student);

        // Mark as editing
        document.getElementById('studentForm').dataset.editingId = id;
        this.showModal();
    },

    // printContract unused, but maps to download
    printContract(id) { this.downloadContractPdf(id); },

    initTheme() {
        const themeBtn = document.getElementById('themeToggle');
        if (!themeBtn) return;

        const applyTheme = (isDark) => {
            if (isDark) {
                document.body.classList.add('dark-mode');
                themeBtn.querySelector('.sun').style.display = 'none';
                themeBtn.querySelector('.moon').style.display = 'block';
                localStorage.setItem('theme', 'dark');
            } else {
                document.body.classList.remove('dark-mode');
                themeBtn.querySelector('.sun').style.display = 'block';
                themeBtn.querySelector('.moon').style.display = 'none';
                localStorage.setItem('theme', 'light');
            }
        };

        // Initial Load
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            applyTheme(true);
        }

        // Toggle Event
        themeBtn.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark-mode');
            applyTheme(!isDark);
        });
    },

    applyBranding() {
        const settings = db.getSettings();
        const logo = settings.schoolLogo || 'assets/logo.png';
        const bg = settings.loginBackground || 'assets/login-bg.jpg';

        // Update Logos
        const logoElements = ['navLogo', 'settingsLogoPreview', 'loginLogo'];
        logoElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Only update if current setting is different to prevent flickering
                if (el.src !== logo) el.src = logo;
            }
        });

        // Update Login Background
        const bgEl = document.getElementById('loginBg');
        if (bgEl) {
            bgEl.style.backgroundImage = `url('${bg}')`;
        }
    },

    saveSettings() {
        const stampText = document.getElementById('schoolStampInput')?.value || '';
        const schoolName = document.getElementById('schoolName')?.value || '';
        const schoolPhone = document.getElementById('schoolPhone')?.value || '';
        const serverAddr = document.getElementById('serverAddress')?.value || '';

        // Chip Inputs (synced to hidden textareas by renderChips)
        const levels = (document.getElementById('schoolLevelsInput')?.value || '').split(',').map(s => s.trim()).filter(s => s);
        const grades = (document.getElementById('schoolGradesInput')?.value || '').split(',').map(s => s.trim()).filter(s => s);

        // Custom Fields
        const customFieldsRaw = document.getElementById('customFieldsSetting')?.value || '[]';
        let customFields = [];
        try { customFields = JSON.parse(customFieldsRaw); } catch (e) { customFields = []; }

        const logo = document.getElementById('settingsLogoPreview')?.src || '';

        // Stamp Image
        const stampPreviewImg = document.querySelector('.school-stamp img');
        const stampImage = stampPreviewImg ? stampPreviewImg.src : '';

        // Security
        const adminUser = document.getElementById('adminUsernameSetting')?.value;
        const adminPass = document.getElementById('adminPassSetting')?.value;

        const currentSettings = db.getSettings();

        // Safe capture of contract IDs (don't overwrite with null if element is missing)
        const nationalEl = document.getElementById('nationalContractSetting');
        const diplomaEl = document.getElementById('diplomaContractSetting');

        const settings = {
            ...currentSettings,
            schoolName,
            schoolStampText: stampText,
            schoolPhone,
            serverAddress: serverAddr,
            levels,
            grades,
            customFields,
            schoolLogo: logo.startsWith('data:') ? logo : (currentSettings.schoolLogo || ''),
            stampImage: stampImage.startsWith('data:') ? stampImage : (currentSettings.stampImage || ''),
            nationalContractId: (nationalEl && nationalEl.value) ? nationalEl.value : currentSettings.nationalContractId,
            diplomaContractId: (diplomaEl && diplomaEl.value) ? diplomaEl.value : currentSettings.diplomaContractId
        };

        if (adminUser) settings.adminUsername = adminUser;
        if (adminPass) settings.adminPassword = adminPass;

        db.saveSettings(settings);
        this.applyBranding();
        this.populateDynamicSelects();

        // Sync to cloud if possible
        if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
            CloudDB.saveSettings(settings);
        }

        this.showNotification('✅ تم حفظ جميع الإعدادات بنجاح');

        // Clear password field for security
        if (document.getElementById('adminPassSetting')) document.getElementById('adminPassSetting').value = '';
    },

    handleLogoUpload(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = document.getElementById('settingsLogoPreview');
                if (img) img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    },

    handleStampUpload(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const previewContainer = document.querySelector('.school-stamp');
                if (previewContainer) {
                    previewContainer.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:contain; border-radius:50%; position:absolute; top:0; left:0; z-index:10;">`;
                }
            };
            reader.readAsDataURL(input.files[0]);
        }
    },

    updateStampPreview() {
        const text = document.getElementById('schoolStampInput').value;
        const previewContainer = document.querySelector('.school-stamp');

        // If image exists, don't revert to text unless user clears image (which needs a reload or clear button)
        // For now, simpler is better: if there is an IMG tag, keep it. If not, update text.
        if (previewContainer && !previewContainer.querySelector('img')) {
            const previewText = document.getElementById('stampPreviewText'); // This ID existed in original HTML
            if (previewText) previewText.textContent = text || 'الإدارة';
            else {
                // Re-create text structure if lost
                previewContainer.innerHTML = `
                    <div style="position: absolute; width: 90%; height: 90%; border: 1px solid var(--primary-main); border-radius: 50%;"></div>
                    <div id="stampPreviewText" style="font-size: 1rem; text-align: center; max-width: 80%; line-height: 1.2;">${text || 'الإدارة'}</div>
                 `;
            }
        }
    },

    // --- New Settings UI Functions ---
    switchSettingsTab(tabId) {
        // Hide all contents
        const contents = document.querySelectorAll('.tab-content');
        contents.forEach(content => {
            content.classList.remove('active');
            content.style.setProperty('display', 'none', 'important');
        });

        // Resolve Content ID
        let content = document.getElementById(`tab-${tabId}`) || document.getElementById(tabId);

        // Fallback: Try mapping common names 
        if (!content) {
            const map = {
                'security': 'tab-account', 'account': 'tab-security',
                'backup': 'tab-system', 'system': 'tab-backup'
            };
            if (map[tabId]) content = document.getElementById(map[tabId]);
        }

        if (content) {
            content.classList.add('active');
            content.style.setProperty('display', 'block', 'important');
        } else {
            console.warn(`Tab content not found for ID: ${tabId}`);
        }

        // Update Buttons
        const buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(btn => btn.classList.remove('active'));

        const activeBtn = document.querySelector(`.tab-btn[onclick*="'${tabId}'"]`);
        if (activeBtn) activeBtn.classList.add('active');

        if (tabId === 'migration') {
            if (typeof this.refreshArchiveTable === 'function') this.refreshArchiveTable();
        }
    },

    // Chip Management
    addChip(storageId, inputId) {
        const input = document.getElementById(inputId);
        const val = input.value.trim();
        if (!val) return;

        const currentVal = document.getElementById(storageId).value;
        const items = currentVal ? currentVal.split(',') : [];
        if (!items.includes(val)) {
            items.push(val);
            this.renderChips(storageId, items);
            input.value = '';
        }
    },

    removeChip(storageId, value) {
        const currentVal = document.getElementById(storageId).value;
        let items = currentVal ? currentVal.split(',') : [];
        items = items.filter(i => i !== value);
        this.renderChips(storageId, items);
    },

    renderChips(storageId, items) {
        // Sync to hidden input
        document.getElementById(storageId).value = items.join(',');

        // Render UI
        const containerId = storageId === 'schoolLevelsInput' ? 'levelsChips' : 'gradesChips';
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = items.length ? items.map(item => `
            <div class="chip">
                <span>${item}</span>
                <div style="display:flex; align-items:center; gap: 4px; margin-right: 8px;">
                    <button onclick="UI.editChip('${storageId}', '${item}')" style="background:rgba(99, 102, 241, 0.1); border:none; color:var(--primary-main); font-size:12px; cursor:pointer; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" title="تعديل" onmouseover="this.style.background='rgba(99, 102, 241, 0.2)'" onmouseout="this.style.background='rgba(99, 102, 241, 0.1)'">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button onclick="UI.removeChip('${storageId}', '${item}')" style="background:rgba(239, 68, 68, 0.1); border:none; color:var(--danger); border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">&times;</button>
                </div>
            </div>
        `).join('') : '<div class="chip-empty">لا توجد عناصر مضافة</div>';
    },

    editChip(storageId, value) {
        let currentVal = document.getElementById(storageId).value;
        let items = currentVal ? currentVal.split(',') : [];

        const index = items.indexOf(value);
        if (index === -1) return;

        const newValue = window.prompt("تعديل الاسم:", value);
        if (newValue !== null && newValue.trim() !== '') {
            items[index] = newValue.trim();
            this.renderChips(storageId, items);
        }
    },

    // Custom Fields Management
    addCustomField() {
        const label = document.getElementById('newFieldLabel')?.value.trim();
        const type = document.getElementById('newFieldType')?.value;
        if (!label) return;

        const hiddenInput = document.getElementById('customFieldsSetting');
        let fields = [];
        try { fields = JSON.parse(hiddenInput.value || '[]'); } catch (e) { }

        fields.push({ id: Date.now(), label, type });
        this.renderCustomFields(fields);

        document.getElementById('newFieldLabel').value = '';
    },

    deleteCustomField(id) {
        const hiddenInput = document.getElementById('customFieldsSetting');
        let fields = [];
        try { fields = JSON.parse(hiddenInput.value || '[]'); } catch (e) { }

        // Use loose/string comparison in case IDs are mixed types
        fields = fields.filter(f => String(f.id) !== String(id));
        this.renderCustomFields(fields);
    },

    renderCustomFields(fields) {
        const hiddenInput = document.getElementById('customFieldsSetting');
        hiddenInput.value = JSON.stringify(fields);

        const container = document.getElementById('customFieldsList');
        if (!container) return;

        container.innerHTML = fields.length ? fields.map(f => `
            <div class="custom-field-item">
                <div class="custom-field-info">
                    <span class="custom-field-label">${f.label}</span>
                    <span class="custom-field-type">النوع: ${f.type === 'text' ? 'نص' : f.type === 'number' ? 'رقم' : 'تاريخ'}</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-icon btn-primary" onclick="UI.editCustomField('${f.id}')" style="width:36px; height:36px; min-width:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:var(--primary-main); border:none; box-shadow:0 2px 4px rgba(99, 102, 241, 0.2);" title="تعديل">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-danger" onclick="UI.deleteCustomField('${f.id}')" style="width:30px; height:30px; min-width:30px;" title="حذف">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
        `).join('') : '<div class="chip-empty">لا توجد حقول إضافية</div>';
    },

    editCustomField(id) {
        const hiddenInput = document.getElementById('customFieldsSetting');
        let fields = [];
        try { fields = JSON.parse(hiddenInput.value || '[]'); } catch (e) { }

        const fieldIndex = fields.findIndex(f => String(f.id) === String(id));
        if (fieldIndex === -1) return;

        const currentLabel = fields[fieldIndex].label;
        const newLabel = window.prompt("تعديل اسم الحقل:", currentLabel);

        if (newLabel !== null && newLabel.trim() !== '') {
            fields[fieldIndex].label = newLabel.trim();
            this.renderCustomFields(fields);
        }
    },

    renderStudentFormFields(student = null) {
        const container = document.getElementById('dynamicCustomFieldsContainer');
        if (!container) return;

        const settings = db.getSettings();
        // Filter out 'nationalId' because it is now hardcoded in the form
        const fields = (settings.customFields || []).filter(f => f.id !== 'nationalId' && f.id !== 'parentNationalId');

        container.innerHTML = fields.map(f => {
            const val = student?.customFields?.[f.id] || '';
            let inputHtml = '';

            if (f.type === 'text') {
                inputHtml = `<input type="text" id="custom_${f.id}" value="${val}" placeholder="${f.label}" style="width: 100%; padding: 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px;">`;
            } else if (f.type === 'number') {
                inputHtml = `<input type="number" id="custom_${f.id}" value="${val}" placeholder="${f.label}" style="width: 100%; padding: 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px;">`;
            } else if (f.type === 'date') {
                inputHtml = `<input type="date" id="custom_${f.id}" value="${val}" style="width: 100%; padding: 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px;">`;
            }

            return `
                <div class="form-group" style="flex: 1 1 45%; min-width: 250px;">
                    <label for="custom_${f.id}" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #4a5568;">${f.label}</label>
                    ${inputHtml}
                </div>
            `;
        }).join('');
    },

    handleLogoUpload(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('settingsLogoPreview');
                if (preview) preview.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    },

    updateStampPreview() {
        const input = document.getElementById('schoolStampInput');
        const preview = document.getElementById('stampPreviewText');
        if (input && preview) {
            preview.textContent = input.value || 'الإدارة';
        }
    },

    populateDynamicSelects() {
        const settings = db.getSettings();

        const levelOptions = (settings.levels || []).map(l => `<option value="${l}">${l}</option>`).join('');
        const gradeOptions = (settings.grades || []).map(g => `<option value="${g}">${g}</option>`).join('');

        // Populate form and filter dropdowns
        const levelSelects = [document.getElementById('studentLevel'), document.getElementById('filterLevel')];
        const gradeSelects = [document.getElementById('studentGrade'), document.getElementById('filterGrade')];

        levelSelects.forEach(sel => {
            if (sel) sel.innerHTML = `<option value="">${sel.id.includes('filter') ? 'المرحلة: الكل' : 'اختر المرحلة'}</option>` + levelOptions;
        });
        gradeSelects.forEach(sel => {
            if (sel) sel.innerHTML = `<option value="">${sel.id.includes('filter') ? 'الصف: الكل' : 'اختر الصف'}</option>` + gradeOptions;
        });

        // Populate Contract Templates
        const contractSelects = [
            document.getElementById('contractTemplate'),
            document.getElementById('nationalContractSetting'),
            document.getElementById('diplomaContractSetting')
        ];
        if (typeof contractMgr !== 'undefined') {
            const templates = contractMgr.getContracts();
            const contractOptions = templates.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
            contractSelects.forEach(sel => {
                if (sel) sel.innerHTML = '<option value="">-- اختر العقد --</option>' + contractOptions;
            });
        }
    },

    loadSettingsPage() {
        try {
            this.populateDynamicSelects(); // Ensure dropdowns are populated first!
            const settings = db.getSettings();

            // Text Inputs
            if (document.getElementById('schoolName')) document.getElementById('schoolName').value = settings.schoolName || '';
            if (document.getElementById('schoolStampInput')) document.getElementById('schoolStampInput').value = settings.schoolStampText || '';
            if (document.getElementById('serverAddress')) document.getElementById('serverAddress').value = settings.serverAddress || '';
            if (document.getElementById('schoolPhone')) document.getElementById('schoolPhone').value = settings.schoolPhone || '';
            if (document.getElementById('adminUsernameSetting')) document.getElementById('adminUsernameSetting').value = settings.adminUsername || 'admin';

            // Load contract assignment settings
            if (document.getElementById('nationalContractSetting')) document.getElementById('nationalContractSetting').value = settings.nationalContractId || '';
            if (document.getElementById('diplomaContractSetting')) document.getElementById('diplomaContractSetting').value = settings.diplomaContractId || '';

            // Logo
            if (document.getElementById('settingsLogoPreview') && settings.schoolLogo) {
                document.getElementById('settingsLogoPreview').src = settings.schoolLogo;
            }

            // Stamp Image
            if (settings.stampImage) {
                const previewContainer = document.querySelector('.school-stamp');
                if (previewContainer) {
                    previewContainer.innerHTML = `<img src="${settings.stampImage}" style="width:100%; height:100%; object-fit:contain; border-radius:50%; position:absolute; top:0; left:0; z-index:10;">`;
                }
            }

            // Chips & Lists
            this.renderChips('schoolLevelsInput', settings.levels || []);
            this.renderChips('schoolGradesInput', settings.grades || []);
            this.renderCustomFields(settings.customFields || []);

            this.updateStampPreview();

            // Always force a render of the active tab to fix any corrupted inline display states
            const activeTabBtn = document.querySelector('.tab-btn.active');
            let targetTab = 'general';
            if (activeTabBtn) {
                const match = activeTabBtn.getAttribute('onclick')?.match(/switchSettingsTab\(['"]([^'"]+)['"]\)/);
                if (match) targetTab = match[1];
            }
            this.switchSettingsTab(targetTab);

        } catch (e) {
            console.error('Error loading settings page:', e);
        }
    },

    async remindParent(id) {
        const student = db.getStudents().find(s => s.id === id);
        if (!student) return;

        const phone = student.parentWhatsapp.replace(/[^0-9]/g, '');
        if (!phone) {
            this.showNotification('❌ لا يوجد رقم واتساب مسجل');
            return;
        }

        const settings = db.getSettings();
        this.showNotification('⏳ جاري تحضير رابط التذكير...');
        const { link } = await this.generateContractLink(student);

        const message = `تذكير: مرحباً ${student.parentName}،%0a%0aنرجو التكرم بتوقيع عقد الطالب *${student.studentName}* لاستكمال إجراءات التسجيل.%0a%0aرابط العقد:%0a${encodeURIComponent(link)}`;

        window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
        db.updateStudentStatus(id, 'sent'); // Update last sent time effectively
        this.showNotification('✅ تم فتح واتساب لإرسال التذكير');
    },

    applyFilters() {
        const searchDash = document.getElementById('studentSearch')?.value.toLowerCase() || '';
        const searchAll = document.getElementById('studentSearchAll')?.value.toLowerCase() || '';
        const searchTerm = searchDash || searchAll;

        const levelTerm = document.getElementById('filterLevel')?.value || '';
        const gradeTerm = document.getElementById('filterGrade')?.value || '';

        const students = db.getStudents().filter(s => {
            const matchesSearch = !searchTerm ||
                (s.studentName || '').toLowerCase().includes(searchTerm) ||
                (s.parentWhatsapp || '').includes(searchTerm) ||
                (s.parentEmail || '').toLowerCase().includes(searchTerm) ||
                (s.parentName || '').toLowerCase().includes(searchTerm);

            const matchesLevel = !levelTerm || s.studentLevel === levelTerm;
            const matchesGrade = !gradeTerm || s.studentGrade === gradeTerm;

            return matchesSearch && matchesLevel && matchesGrade;
        });

        // Apply Current Sort
        this.sortAndRender(students);
    },

    sortStudents(field) {
        if (this.currentSort.field === field) {
            this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.field = field;
            this.currentSort.order = 'asc';
        }
        this.applyFilters();
    },

    sortAndRender(students) {
        const field = this.currentSort.field;
        const order = this.currentSort.order === 'asc' ? 1 : -1;

        students.sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';

            if (field === 'createdAt') {
                return (new Date(valA) - new Date(valB)) * order;
            }

            return String(valA).localeCompare(String(valB), 'ar') * order;
        });

        this.renderStudents(students);
    },

    // --- Bulk Actions Queue System ---
    bulkQueue: [],
    bulkQueueIndex: 0,
    bulkActionType: '', // 'send' or 'remind'

    startBulkAction(type) {
        const checks = document.querySelectorAll('#allStudentsTableBody .student-checkbox:checked');
        if (checks.length === 0) {
            this.showNotification('⚠️ الرجاء اختيار طلاب أولاً');
            return;
        }

        const ids = Array.from(checks).map(c => c.value);
        this.bulkQueue = ids;
        this.bulkQueueIndex = 0;
        this.bulkActionType = type;

        // Reset UI
        document.getElementById('bulkQueueModal').style.display = 'block';
        document.getElementById('bulkQueueActions').style.display = 'block';
        document.getElementById('bulkQueueComplete').style.display = 'none';

        const title = type === 'send' ? 'إرسال العقود الجماعي' : 'إرسال التذكيرات الجماعي';
        document.getElementById('bulkQueueTitle').textContent = title;

        this.updateBulkUI();
    },

    updateBulkUI() {
        const total = this.bulkQueue.length;
        const current = this.bulkQueueIndex + 1;

        if (this.bulkQueueIndex >= total) {
            // Finished
            document.getElementById('bulkQueueActions').style.display = 'none';
            document.getElementById('bulkQueueComplete').style.display = 'block';
            document.getElementById('bulkQueueProgress').textContent = `${total}/${total}`;
            return;
        }

        document.getElementById('bulkQueueProgress').textContent = `${current}/${total}`;

        const studentId = this.bulkQueue[this.bulkQueueIndex];
        const student = db.getStudents().find(s => s.id === studentId);

        if (student) {
            document.getElementById('bulkStudentName').textContent = student.studentName;
        } else {
            // Skip invalid ID
            this.bulkQueueIndex++;
            this.updateBulkUI();
        }
    },

    processNextInQueue() {
        const studentId = this.bulkQueue[this.bulkQueueIndex];

        if (this.bulkActionType === 'send') {
            this.sendContract(studentId); // Reuses existing logic
        } else {
            this.remindParent(studentId); // Reuses existing logic
        }

        // Advance
        this.bulkQueueIndex++;

        // Slight delay to allow UI update after window open
        setTimeout(() => {
            this.updateBulkUI();
        }, 1000);
    },

    closeBulkModal() {
        document.getElementById('bulkQueueModal').style.display = 'none';
        this.bulkQueue = [];
        this.renderStudents(); // Refresh to uncheck
    },

    exportToExcel() {
        console.log('📊 Exporting to Excel...');
        if (typeof XLSX === 'undefined') {
            this.showNotification('⚠️ مكتبة الإكسل غير محملة');
            return;
        }

        // Use filters from the "All Students" page for consistency
        const searchTerm = document.getElementById('studentSearchAll')?.value.toLowerCase() || '';
        const levelTerm = document.getElementById('filterLevel')?.value || '';
        const gradeTerm = document.getElementById('filterGrade')?.value || '';

        const students = db.getStudents().filter(s => {
            const matchesSearch = !searchTerm ||
                (s.studentName || '').toLowerCase().includes(searchTerm) ||
                (s.parentWhatsapp || '').includes(searchTerm) ||
                (s.parentEmail || '').toLowerCase().includes(searchTerm) ||
                (s.parentName || '').toLowerCase().includes(searchTerm);

            const matchesLevel = !levelTerm || s.studentLevel === levelTerm;
            const matchesGrade = !gradeTerm || s.studentGrade === gradeTerm;
            return matchesSearch && matchesLevel && matchesGrade;
        });

        if (students.length === 0) {
            this.showNotification('⚠️ لا توجد بيانات لتصديرها');
            return;
        }

        try {
            const settings = db.getSettings();
            const exportData = students.map(s => {
                const row = {
                    'اسم الطالب': s.studentName,
                    'المسار': s.customFields?.studentTrack || s.studentTrack || '-',
                    'المرحلة': s.studentLevel,
                    'الصف': s.studentGrade,
                    'اسم ولي الأمر': s.parentName,
                    'البريد الإلكتروني': s.parentEmail,
                    'رقم الواتساب': s.parentWhatsapp,
                    'حالة العقد': this.getStatusText(s.contractStatus),
                    'السنة الدراسية': s.contractYear || ''
                };

                // Dynamically add custom fields to the export
                if (settings.customFields && s.customFields) {
                    settings.customFields.forEach(fieldDef => {
                        if (fieldDef.id !== 'studentTrack') { // Avoid duplicating track
                            row[fieldDef.label] = s.customFields[fieldDef.id] || '-';
                        }
                    });
                }
                return row;
            });

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');

            worksheet['!dir'] = 'rtl';

            // Dynamically set column widths based on the final headers
            const headers = Object.keys(exportData[0] || {});
            worksheet['!cols'] = headers.map(header => {
                if (header.includes('اسم') || header.includes('البريد')) return { wch: 25 };
                if (header.includes('المسار')) return { wch: 20 };
                return { wch: 15 };
            });

            const fileName = `قائمة_الطلاب_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;

            XLSX.writeFile(workbook, fileName);
            this.showNotification('✅ تم تصدير القائمة بنجاح');
        } catch (error) {
            console.error('Export Error:', error);
            this.showNotification('❌ فشل تصدير الملف');
        }
    },

    backupAllData() {
        console.log('💾 Starting Full Backup...');
        if (typeof XLSX === 'undefined') {
            this.showNotification('⚠️ مكتبة الإكسل غير محملة');
            return;
        }

        const students = db.getStudents(); // Get ALL students unfiltered
        if (students.length === 0) {
            this.showNotification('⚠️ لا توجد بيانات لحفظها');
            return;
        }

        try {
            const exportData = students.map(s => ({
                'الرقم التسلسلي (ID)': s.id,
                'اسم الطالب': s.studentName,
                'هوية الطالب': s.nationalId || s.customFields?.nationalId || '-',
                'المرحلة': s.studentLevel,
                'الصف': s.studentGrade,
                'المسار': s.studentTrack || '-',
                'اسم ولي الأمر': s.parentName,
                'هوية ولي الأمر': s.parentNationalId || s.customFields?.parentNationalId || '-',
                'البريد الإلكتروني': s.parentEmail,
                'رقم الواتساب': s.parentWhatsapp,
                'الجنسية': s.nationality || s.customFields?.nationality || '-',
                'نوع التسجيل': s.registrationType === 'mustajid' ? 'مستجد' : 'منتظم',
                'حالة العقد': this.getStatusText(s.contractStatus),
                'وقت التوقيع': s.signedAt ? new Date(s.signedAt).toLocaleString('ar-SA') : '-',
                'تاريخ الإضافة': s.createdAt ? new Date(s.createdAt).toLocaleDateString('ar-SA') : '-',
                'رابط العقد (احتياطي)': this.generateContractLink(s).link
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Full_Backup');

            worksheet['!dir'] = 'rtl';
            worksheet['!cols'] = [
                { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 50 }
            ];

            const fileName = `نسخة_كاملة_دانات_${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(workbook, fileName);
            this.showNotification('✅ تم حفظ النسخة الاحتياطية الشاملة');
        } catch (error) {
            console.error('Backup Error:', error);
            this.showNotification('❌ فشل العملية');
        }
    },

    getStatusText(status) {
        const texts = {
            'pending': 'قيد الانتظار',
            'sent': 'تم الإرسال',
            'signed': 'تم التوقيع',
            'verified': 'موثق'
        };
        return texts[status] || status;
    },

    refreshData() {
        this.updateStats();
        this.renderStudents();
    },


    async handleLogin() {
        const usernameInput = document.getElementById('adminUserInput');
        const passwordInput = document.getElementById('adminPassInput');
        const errorMsg = document.getElementById('loginError');
        const loginOverlay = document.getElementById('loginOverlay');
        const loginBtn = document.querySelector('.btn-primary[onclick*="handleLogin"]');

        if (!usernameInput || !passwordInput) return;

        const inputUser = usernameInput.value.trim();
        const inputPass = passwordInput.value.trim();

        // 1. Initial Local Check
        const settings = db.getSettings();
        const storedUser = settings?.adminUsername || 'admin';
        const storedPass = settings?.adminPassword || 'admin';

        let isMatch = inputUser === storedUser && inputPass === storedPass;

        // 2. Cloud Fallback (Critical for new devices)
        if (!isMatch && typeof CloudDB !== 'undefined') {
            if (loginBtn) {
                loginBtn.innerHTML = 'جاري التحقق من السحابة...';
                loginBtn.disabled = true;
            }
            try {
                // Try fetching settings using the input credentials as a "one-time key"
                const cloudSettings = await CloudDB.getSettings(inputUser, inputPass);

                // If it's a valid object and NOT an error response, we are authorized
                if (cloudSettings && !cloudSettings.error && cloudSettings.adminUsername) {
                    const cUser = cloudSettings.adminUsername;
                    const cPass = cloudSettings.adminPassword;

                    if (inputUser === cUser && inputPass === cPass) {
                        isMatch = true;
                        // Update local immediately for next time
                        localStorage.setItem('appSettings', JSON.stringify(cloudSettings));
                        console.log('✅ Cloud Login Successful - Local settings updated');
                    }
                }
            } catch (e) { console.error('Cloud login fallback failed', e); }
            finally {
                if (loginBtn) {
                    loginBtn.innerHTML = 'دخول النظام';
                    loginBtn.disabled = false;
                }
            }
        }

        if (isMatch) {
            console.log('✅ Login Authorized. Syncing cloud data...');

            if (loginBtn) {
                loginBtn.innerHTML = '<span class="spinner"></span> جاري جلب بياناتك...';
                loginBtn.disabled = true;
            }

            try {
                // FORCE RECOVERY immediately
                await CloudDB.syncCloudToLocal();
                console.log('✅ Cloud Data Recovered Successfully');

                // Set login session ONLY after data is verified locally
                sessionStorage.setItem('isLoggedIn', 'true');

                if (loginOverlay) loginOverlay.style.display = 'none';

                // Refresh entire UI with new data
                this.updateStats();
                this.renderStudents();
                this.populateDynamicSelects();
                this.applyBranding();

                if (typeof UI !== 'undefined' && UI.showNotification) {
                    UI.showNotification('✅ تم تسجيل الدخول ومزامنة الطلاب والعقود');
                }
            } catch (err) {
                console.error('Initial Sync Failed:', err);
                // Fallback for weird network issues
                sessionStorage.setItem('isLoggedIn', 'true');
                if (loginOverlay) loginOverlay.style.display = 'none';
                this.refreshData();
            }
        } else {
            console.warn('❌ Login Failed');
            if (errorMsg) {
                errorMsg.style.display = 'block';
                errorMsg.innerHTML = `❌ بيانات الدخول غير صحيحة.`;
            }
            // Shake effect
            const card = usernameInput.closest('.card');
            if (card) {
                card.style.animation = 'none';
                void card.offsetWidth;
                card.style.animation = 'shake 0.5s';
            }
        }
    },

    checkLogin() {
        const loginOverlay = document.getElementById('loginOverlay');
        const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true' || localStorage.getItem('isLoggedIn') === 'true';

        if (isLoggedIn) {
            if (loginOverlay) loginOverlay.style.display = 'none';
            this.applyBranding();
            this.updateStats();
            this.renderStudents();
            this.populateDynamicSelects();
        } else {
            if (loginOverlay) loginOverlay.style.display = 'flex';
        }
    },

    logout() {
        if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
            sessionStorage.removeItem('isLoggedIn');
            localStorage.removeItem('isLoggedIn');
            window.location.reload();
        }
    },

    markAsSigned(id) {
        if (confirm('تأكيد استلام وتوثيق العقد؟')) {
            db.updateStudentStatus(id, 'verified');
            this.updateStats();
            this.renderStudents();
            this.showNotification('✅ تم توثيق العقد بنجاح');
        }
    },

    importFromExcel(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Get raw 2D array to find the true header row
                const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (rawData.length === 0) {
                    this.showNotification('⚠️ الملف فارغ');
                    return;
                }

                // Find header row index
                let headerRowIndex = -1;
                const normalizeConfig = (s) => String(s || '').trim().replace(/[أإآ]/g, 'ا').toLowerCase();

                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    const row = rawData[i];
                    if (!Array.isArray(row)) continue;
                    if (row.some(cell => normalizeConfig(cell).includes('اسم الطالب'))) {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    alert('❌ تعذر العثور على عمود "اسم الطالب" في الملف. يرجى مراجعة الملف.');
                    input.value = '';
                    return;
                }

                const headerRow = rawData[headerRowIndex];
                const jsonData = [];
                for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                    const rowArray = rawData[i];
                    if (!rowArray || rowArray.length === 0) continue;
                    const rowObj = {};
                    let hasData = false;
                    headerRow.forEach((colName, colIndex) => {
                        if (colName) {
                            rowObj[colName] = rowArray[colIndex];
                            if (rowArray[colIndex] !== undefined && rowArray[colIndex] !== null && String(rowArray[colIndex]).trim() !== '') {
                                hasData = true;
                            }
                        }
                    });
                    if (hasData) jsonData.push(rowObj);
                }

                if (jsonData.length === 0) {
                    this.showNotification('⚠️ لا يوجد بيانات للطلاب تحت العناوين');
                    return;
                }

                const settings = db.getSettings();
                const nationalContractId = settings.nationalContractId;
                const diplomaContractId = settings.diplomaContractId;
                let importedCount = 0;

                jsonData.forEach((row, index) => {
                    const getVal = (possibleHeaders) => {
                        const normalize = (s) => String(s || '').trim().replace(/[أإآ]/g, 'ا').toLowerCase();
                        const normalizedPossible = possibleHeaders.map(normalize);
                        const actualKey = Object.keys(row).find(rk => normalizedPossible.includes(normalize(rk)));
                        return actualKey !== undefined ? String(row[actualKey]).trim() : '';
                    };

                    // Prioritize 'نوع الدراسة' because 'نوع القسم' in the financial export just says 'بنين/بنات'
                    const trackValue = getVal(['نوع الدراسة', 'نوع الدراسه', 'المسار', 'مسار', 'Track']) || getVal(['نوع القسم']);
                    const trackLower = trackValue.toLowerCase();
                    let assignedContractId = null;

                    if (trackLower.includes('دبلوم') || trackLower.includes('عالمي')) {
                        assignedContractId = diplomaContractId;
                    } else if (trackLower.includes('أهلي') || trackLower.includes('اهلي') || trackLower.includes('ثنائي') || trackLower.includes('عام') || trackLower.includes('نظامي')) {
                        assignedContractId = nationalContractId;
                    } else if (trackLower.includes('بنين') || trackLower.includes('بنات')) {
                        // Section info as fallback
                        assignedContractId = nationalContractId;
                    }

                    // Parse Level and Grade handling combined case like 'المرحلة - الصف'
                    let parsedLevel = getVal(['المرحلة', 'المرحله', 'Level']);
                    let parsedGrade = getVal(['الصف', 'الصف الدراسي', 'Grade']);
                    const levelGradeCombined = getVal(['المرحلة - الصف']);

                    if (!parsedGrade && levelGradeCombined) {
                        parsedGrade = levelGradeCombined;
                    }
                    if (!parsedLevel && levelGradeCombined) {
                        if (levelGradeCombined.includes('تمهيدي') || levelGradeCombined.includes('روض')) parsedLevel = 'رياض أطفال';
                        else if (levelGradeCombined.includes('ابتدائي')) parsedLevel = 'الابتدائية';
                        else if (levelGradeCombined.includes('متوسط')) parsedLevel = 'المتوسطة';
                        else if (levelGradeCombined.includes('ثانوي')) parsedLevel = 'الثانوية';
                        else parsedLevel = levelGradeCombined;
                    }

                    // Collect custom fields from user config dynamically mapping
                    const customFields = {};
                    (settings.customFields || []).forEach(fieldDef => {
                        const val = getVal([fieldDef.label]);
                        if (val) customFields[fieldDef.id] = val;
                    });

                    const phoneValue = getVal(['رقم الواتساب', 'رقم الواتس', 'الجوال', 'رقم الجوال', 'WhatsApp', 'Phone', 'جوال الأب 1', 'جوال الاب 1', 'جوال الأب', 'جوال الاب']) || getVal(['جوال الأب 2', 'جوال الاب 2', 'جوال الأم', 'جوال الام']);

                    let regType = 'existing';
                    const rawRegType = getVal(['حالة الطالب', 'نوع التسجيل', 'Registration']);
                    if (rawRegType.includes('مستجد') || rawRegType.includes('جديد')) {
                        regType = 'mustajid';
                    }

                    // Strict matching for National ID to avoid 'رقم الطالب' (internal ID)
                    const student = {
                        id: Date.now().toString() + index, // Temp ID
                        studentName: getVal(['اسم الطالب', 'الاسم', 'Name']),
                        parentName: getVal(['اسم ولي الأمر', 'اسم ولي الامر', 'اسم الاب', 'اسم الأب', 'ولي الأمر', 'ولي الامر', 'Parent Name', 'Parent']) || 'ولي أمر الطالب ' + getVal(['اسم الطالب', 'الاسم']),
                        parentEmail: getVal(['البريد الإلكتروني', 'البريد الالكتروني', 'الإيميل', 'الايميل', 'Email']) || 'lamyojad@email.com',
                        parentWhatsapp: phoneValue || '00000000',
                        studentLevel: parsedLevel || 'غير محدد',
                        studentGrade: parsedGrade || 'غير محدد',
                        studentTrack: trackValue || 'عام',
                        nationalId: getVal(['هوية الطالب', 'رقم هوية الطالب', 'National ID']) || getVal(['رقم الهوية']),
                        parentNationalId: getVal(['رقم هوية الأب', 'رقم هوية الاب', 'هوية ولي الأمر', 'هوية ولي الامر', 'سجل ولي الأمر', 'Parent ID', 'ParentID']),
                        contractYear: getVal(['السنة الدراسية', 'السنه الدراسيه', 'السنة', 'Year']) || new Date().getFullYear().toString(),
                        sendMethod: getVal(['طريقة الإرسال', 'طريقة الارسال', 'SendMethod']) || 'whatsapp',
                        registrationType: regType,
                        studentNationality: getVal(['جنسية الطالب', 'الجنسية', 'Nationality']) || 'سعودي',
                        contractStatus: 'pending',
                        contractTemplateId: assignedContractId,
                        customFields: customFields
                    };

                    // Ensure key fields are in customFields for display
                    student.customFields.studentTrack = student.studentTrack;
                    student.customFields.nationalId = student.nationalId;
                    student.customFields.parentNationalId = student.parentNationalId;
                    student.customFields.registrationType = student.registrationType;
                    student.customFields.studentGrade = student.studentGrade;
                    student.customFields.studentLevel = student.studentLevel;

                    if (student.studentName) {
                        db.saveStudent(student);
                        importedCount++;
                    }
                });

                this.showNotification(`✅ تم استيراد ${importedCount} طالب بنجاح`);
                this.renderStudents();
                this.updateStats();
                this.closeImportModal();
                input.value = ''; // Reset input
            } catch (err) {
                console.error('Excel Import Error:', err);
                this.showNotification('❌ فشل في قراءة ملف الإكسل');
            }
        };
        reader.readAsArrayBuffer(file);
    },

    // --- DATA WIPING (DANGER ZONE) ---
    // (Redundant old wipeAllData removed, using the one at the end of the UI object)

    exportSystemJSON() {
        console.log('💾 Starting System Snapshot...');
        const students = db.getStudents(true); // Include archived students in full backup
        const settings = db.getSettings();

        const backup = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            source: 'Danat_System',
            students: students,
            settings: settings
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `نسخة_نظام_كاملة_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        this.showNotification('✅ تم تحميل ملف الاستعادة الكامل بنجاح');
    },

    importSystemJSON(input) {
        const file = input.files[0];
        if (!file) return;

        console.log('📂 Attempting to restore system from file:', file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                let backup;
                const result = e.target.result;

                // Handle potential Data URL prefix if present (though readAsText shouldn't have it)
                const jsonStr = result.startsWith('data:') ? decodeURIComponent(result.split(',')[1]) : result;

                try {
                    backup = JSON.parse(jsonStr);
                } catch (parseError) {
                    console.error('JSON Parse Error:', parseError);
                    alert('خطأ: الملف المختار ليس ملف نظام صالح (JSON Error).');
                    return;
                }

                // Validate Structure
                if (!backup || typeof backup !== 'object') {
                    throw new Error('Invalid backup structure');
                }

                // If it's a legacy or simple array
                let studentsToRestore = [];
                let settingsToRestore = null;

                if (Array.isArray(backup)) {
                    // Assume it's just a list of students (old format)
                    studentsToRestore = backup;
                } else if (backup.students && Array.isArray(backup.students)) {
                    // Standard new format
                    studentsToRestore = backup.students;
                    settingsToRestore = backup.settings;
                } else {
                    throw new Error('Backup file must contain students array');
                }

                if (confirm(`هل أنت متأكد من استعادة النسخة الاحتياطية؟\n\nعدد الطلاب: ${studentsToRestore.length}\nتاريخ النسخة: ${backup.timestamp ? new Date(backup.timestamp).toLocaleDateString('ar-SA') : 'غير محدد'}\n\n⚠️ تحذير: سيتم استبدال البيانات الحالية بالكامل.`)) {

                    // 1. Restore Settings
                    if (settingsToRestore) {
                        db.saveSettings(settingsToRestore);
                    }

                    // 2. Restore Students
                    localStorage.setItem('students', JSON.stringify(studentsToRestore));

                    // 3. Sync to Cloud (Force Overwrite Cloud with Backup)
                    if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
                        console.log('☁️ Syncing restored data to cloud...');
                        // First clear cloud to avoid merging with old deleted data
                        // Actually, syncLocalToCloud does an update, let's be safer and set.
                        // For now, standard sync is fine as it updates by ID.
                        CloudDB.syncLocalToCloud().then(() => {
                            console.log('✅ Cloud synced successfully');
                        });
                    }

                    this.showNotification('✅ تم استعادة النظام بالكامل بنجاح!');
                    setTimeout(() => window.location.reload(), 1500);
                }
            } catch (err) {
                console.error('Restore Logic Error:', err);
                this.showNotification('❌ ملف النسخة الاحتياطية غير صالح أو تالف');
                alert('تفاصيل الخطأ: ' + err.message);
            }
        };
        reader.readAsText(file);
        input.value = ''; // Reset
    },

    downloadExcelTemplate() {
        console.log('📊 Generating Excel Template...');
        try {
            if (typeof XLSX === 'undefined') {
                this.showNotification('⚠️ مكتبة الإكسل غير محملة، يرجى التأكد من الاتصال بالإنترنت');
                return;
            }

            // بناء نموذج الإكسل ليتطابق تماماً مع حقول الإضافة اليدوية في المنصة
            const settings = db.getSettings();
            const rowData = {
                'اسم الطالب': 'محمد أحمد علي',
                'الجنسية': 'سعودي',
                'المسار التعليمي': 'مسار ثنائي اللغة',
                'المرحلة الدراسية': 'الابتدائية',
                'الصف الدراسي': 'الصف الأول',
                'هوية الطالب': '1111111111',
                'اسم ولي الأمر': 'أحمد علي',
                'هوية ولي الأمر': '1020304050',
                'البريد الإلكتروني': 'parent@example.com',
                'رقم الواتساب': '966500000000',
                'طريقة الإرسال': 'whatsapp',
                'نوع التسجيل': 'مستجد', // أو منتظم
                'السنة الدراسية': '2024-2025'
            };

            // إضافة الحقول المخصصة تلقائياً إلى النموذج
            const customHeaders = [];
            if (settings.customFields && Array.isArray(settings.customFields)) {
                settings.customFields.forEach(field => {
                    // Skip if the user left duplicate 'nationalId' or 'parentNationalId' custom fields since they are now core
                    if (field.id !== 'nationalId' && field.id !== 'parentNationalId') {
                        rowData[field.label] = `(مثال: ${field.label})`;
                        customHeaders.push({ wch: 20 });
                    }
                });
            }

            const templateData = [rowData];

            const worksheet = XLSX.utils.json_to_sheet(templateData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');

            worksheet['!dir'] = 'rtl';
            const standardCols = [
                { wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 20 },
                { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
            ];
            worksheet['!cols'] = [...standardCols, ...customHeaders];

            try {
                XLSX.writeFile(workbook, 'نموذج_استيراد_الطلاب.xlsx');
                this.showNotification('✅ تم تحميل نموذج الإكسل');
            } catch (err) {
                console.warn('XLSX.writeFile failed, trying fallback blobing...', err);
                const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
                const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = 'نموذج_استيراد_الطلاب.xlsx';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                }, 100);
                this.showNotification('✅ تم تحميل نموذج الإكسل (fallback)');
            }
        } catch (error) {
            console.error('Download Error:', error);
            this.showNotification('❌ فشل تحميل الملف، حاول مرة أخرى');
        }
    },

    // (Removed duplicate switchSettingsTab here)

    async startMigration() {
        const nextYear = document.getElementById('nextYearLabel').value.trim();
        if (!nextYear) {
            alert('يرجى إدخال مسمى السنة الدراسية القادمة أولاً.');
            return;
        }

        const stats = db.getStats();
        if (!confirm(`هل أنت متأكد من بدء ترحيل جميع الطلاب للسنة (${nextYear})؟\n\nتنبيه: سيتم أرشفة العقود الحالية لعدد (${stats.signed}) طالب موقع.\nستتم تصفير التواقيع وبدء سنة جديدة.`)) {
            return;
        }

        try {
            this.showNotification('⏳ جاري تنفيذ عملية الترحيل...');
            const result = db.migrateStudents(nextYear);

            this.showNotification(`✅ اكتمل الترحيل: تم ترفيع ${result.promotedCount} طلاب وأرشفة ${result.archivedCount} طلاب متخرجين.`);
            this.renderStudents();
            this.updateStats();
            this.refreshArchiveTable();
        } catch (error) {
            console.error('Migration Error:', error);
            alert('حدث خطأ أثناء الترحيل: ' + error.message);
        }
    },

    archiveStudent(id) {
        if (!confirm('هل أنت متأكد من نقل هذا الطالب للأرشيف؟ لن يظهر في القوائم النشطة.')) return;
        const students = db.getStudents(true);
        const student = students.find(s => String(s.id) === String(id));
        if (student) {
            student.isArchived = true;
            db.saveStudent(student); // This handles both local and cloud sync
            this.renderStudents();
            this.updateStats();
            this.showNotification('✅ تم نقل الطالب للأرشيف بنجاح');
        }
    },

    async unarchiveStudent(id) {
        if (!confirm('هل تريد إعادة هذا الطالب للقائمة النشطة؟')) return;
        const students = db.getStudents(true);
        const student = students.find(s => String(s.id) === String(id));
        if (student) {
            student.isArchived = false;
            await db.saveStudent(student); // Await async save
            this.renderStudents();
            this.refreshArchiveTable();
            this.updateStats();
            this.showNotification('✅ تم استعادة الطالب للقائمة النشطة');
        }
    },

    bulkArchiveStudents() {
        const checks = document.querySelectorAll('.student-checkbox:checked');
        const ids = Array.from(checks).map(cb => cb.value);
        if (ids.length === 0) {
            this.showNotification('⚠️ يرجى اختيار طلاب أولاً');
            return;
        }

        if (confirm(`هل أنت متأكد من نقل عدد (${ids.length}) طلاب للأرشيف؟`)) {
            const students = db.getStudents(true);
            ids.forEach(id => {
                const student = students.find(s => String(s.id) === String(id));
                if (student) student.isArchived = true;
            });
            db.saveStudents(students);
            this.renderStudents();
            this.updateStats();
            this.refreshArchiveTable();

            // Sync all to Cloud if ready
            if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
                CloudDB.syncLocalToCloud();
            }

            this.showNotification(`✅ تم أرشفة ${ids.length} طلاب بنجاح`);

            // Uncheck header
            const headerCheck = document.getElementById('selectAllAllStudents');
            if (headerCheck) headerCheck.checked = false;
        }
    },

    refreshArchiveTable() {
        const tbody = document.getElementById('archiveTableBody');
        if (!tbody) return;

        const archived = db.getStudents(true).filter(s => s.isArchived);
        tbody.innerHTML = '';

        if (archived.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">لا يوجد طلاب في الأرشيف حالياً</td></tr>';
            return;
        }

        archived.forEach(student => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><div style="font-weight: bold;">${student.studentName}</div></td>
                <td>${student.studentTrack || '-'}</td>
                <td>${student.studentGrade || '-'}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                        <button class="btn btn-secondary btn-sm" onclick="UI.viewStudentHistory('${student.id}')" title="عرض العقود السابقة">📜 السجل</button>
                        <button class="btn btn-primary btn-sm" onclick="UI.unarchiveStudent('${student.id}')" style="background:#10b981">🔄 استعادة</button>
                        <button class="btn btn-icon" onclick="UI.deleteStudent('${student.id}'); UI.refreshArchiveTable();" style="color: #ef4444;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    },

    viewStudentHistory(studentId) {
        console.log('📜 Viewing history for student:', studentId);
        const student = db.getStudents(true).find(s => String(s.id) === String(studentId));
        if (!student) return;

        if (!student.contractHistory || student.contractHistory.length === 0) {
            alert('لا يوجد سجل عقود سابقة محفوظ لهذا الطالب حالياً.');
            return;
        }

        let historyHtml = `
            <div style="direction: rtl; text-align: right; font-family: 'Cairo', sans-serif;">
                <h2 style="margin-bottom:1.5rem; border-bottom: 2px solid var(--primary-main); padding-bottom:0.5rem; color: var(--primary-main);">سجل العقود والأرشفة: ${student.studentName}</h2>
                <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        `;

        student.contractHistory.forEach((h, idx) => {
            historyHtml += `
                <div style="border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; background: #fff; box-shadow: var(--shadow-sm);">
                    <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom:1rem; border-bottom: 1px dashed var(--border-color); padding-bottom:0.5rem;">
                        <span style="font-weight:800; font-size: 1.1rem; color:var(--text-primary);">السنة الدراسية: ${h.contractYear}</span>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <button class="btn btn-secondary btn-sm" onclick="UI.downloadPastContract('${student.id}', ${idx})" style="background:#4f46e5; color:white; border:none;">📥 تحميل PDF</button>
                            <span style="background: var(--primary-light); color: var(--primary-main); padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 700;">موثق في: ${h.signedAt && !isNaN(new Date(h.signedAt).getTime()) ? new Date(h.signedAt).toLocaleDateString('ar-SA') : '---'}</span>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size:0.95rem;">
                        <div><strong style="color:var(--text-muted)">العقد:</strong> ${h.contractTitle || '-'}</div>
                        <div><strong style="color:var(--text-muted)">الصف:</strong> ${h.studentGrade}</div>
                        <div style="grid-column: 1/-1; margin-top:1rem;">
                            <strong style="display:block; margin-bottom:0.5rem; color:var(--text-muted);">التوقيع المحفوظ:</strong>
                            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; display: inline-block;">
                                ${h.signature ? `<img src="${h.signature}" style="max-height:80px; display:block;">` : '<span style="color:#ef4444">بدون توقيع</span>'}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        historyHtml += `</div></div>`;

        // Use the preview modal to show history
        const previewModal = document.getElementById('contractPreviewModal');
        const previewBody = document.getElementById('contractPreviewBody');
        if (previewModal && previewBody) {
            previewBody.innerHTML = historyHtml;
            previewModal.classList.add('active');
            previewModal.style.display = 'flex';
        }
    },

    testMigrateStudent(id) {
        if (!confirm('سيتم اعتبار هذا الطالب منتقلاً لسنة دراسية جديدة. سيتم حفظ عقده الحالي في "السجل" وتصفير حالته للبدء من جديد. هل أنت متأكد؟')) return;

        const students = db.getStudents(true);
        const index = students.findIndex(s => String(s.id) === String(id));
        if (index === -1) return;

        const student = students[index];
        const currentYear = student.contractYear || 'سنة حالية';

        // 1. Snapshot the current contract into history
        if (!student.contractHistory) student.contractHistory = [];
        const template = student.contractTemplateId ? contractMgr.getContract(student.contractTemplateId) : null;

        student.contractHistory.push({
            contractYear: currentYear,
            studentGrade: student.studentGrade || '',
            studentLevel: student.studentLevel || '',
            contractTitle: student.contractTitle || 'عقد تجريبي',
            contractContent: student.contractContent || '',
            contractType: student.contractType || 'text',
            pdfData: student.pdfData || (template ? template.pdfData : null),
            pdfFields: template ? template.pdfFields : null,
            signature: student.signature || student.signatureData || null,
            idImage: student.idImage || student.idCardImage || null,
            signedAt: student.signedAt || new Date().toISOString(),
            contractStatus: student.contractStatus,
            contractTemplateId: student.contractTemplateId || ''
        });

        // 2. Prepare for "Next Year"
        student.contractStatus = 'pending';
        student.signature = null;
        student.signatureData = null;
        student.idImage = null;
        student.signedAt = null;
        student.contractYear = '1447هـ (تجريبي)';

        db.saveStudents(students);
        this.renderStudents();
        this.updateStats();
        this.showNotification('✅ تم الترحيل التجريبي! اضغط الآن على "سجل العقود" لرؤية النتيجة.');
    },

    async downloadPastContract(studentId, historyIndex) {
        const student = db.getStudents(true).find(s => String(s.id) === String(studentId));
        if (!student || !student.contractHistory || !student.contractHistory[historyIndex]) return;

        const hist = student.contractHistory[historyIndex];
        this.showNotification('⏳ جاري تجهيز العقد القديم...');

        // Build a temporary student object for the PDF generator
        const tempStudent = {
            ...student,
            contractTitle: hist.contractTitle,
            contractContent: hist.contractContent,
            contractType: hist.contractType,
            pdfData: hist.pdfData,
            signature: hist.signature,
            signedAt: hist.signedAt,
            contractStatus: hist.contractStatus,
            studentGrade: hist.studentGrade,
            contractYear: hist.contractYear
        };

        if (hist.contractType === 'pdf_template' || (hist.contractType === 'pdf' && (hist.pdfData || student.pdfData))) {
            // Regeneration for PDF Template History
            try {
                if (typeof contractMgr === 'undefined') throw new Error('Contract Manager not found');

                // Fallback: If history doesn't have PDF data, try to get it from the original template
                let pdfData = hist.pdfData;
                if (!pdfData && hist.contractTemplateId) {
                    console.log('🔄 Attempting to recover PDF data from original template:', hist.contractTemplateId);
                    pdfData = await contractMgr.getPdfFromDB(hist.contractTemplateId);
                }

                if (!pdfData) throw new Error("بيانات الـ PDF غير متوفرة في السجل أو القالب الأصلي");

                // Construct a mock template object from history
                const mockTemplate = {
                    id: hist.contractTemplateId || 'history',
                    title: hist.contractTitle,
                    content: hist.contractContent,
                    type: 'pdf_template',
                    pdfData: pdfData,
                    pdfFields: hist.pdfFields || []
                };

                const pdfBytes = await contractMgr.generatePdfFromTemplate(mockTemplate, tempStudent);
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `عقد_${tempStudent.studentName}_${hist.contractYear}.pdf`;
                link.click();
            } catch (err) {
                console.error('PDF History Download Error:', err);
                alert('فشل في توليد ملف PDF التاريخي: ' + err.message);
            }
        } else {
            // Text-based contract
            this.downloadContractPdf(studentId, tempStudent);
        }
    },
    async wipeAllData() {
        if (!confirm('⛔ تحذير أمني هام ⛔\n\nأنت على وشك حذف جميع البيانات (الطلاب، العقود، والإعدادات) من المتصفح ومن الخادم السحابي.\n\nهل أنت متأكد من رغبتك في تصفير النظام بالكامل؟ لا يمكن التراجع عن هذه الخطوة.')) return;

        if (!confirm('تأكيد نهائي: سيتم حذف كل شيء محلياً وسحابياً. هل أنت متأكد 100%؟')) return;

        console.log('🧨 Performing Factory Reset...');
        this.showNotification('⏳ جاري تصفير النظام...');

        try {
            // 1. Clear Cloud if possible
            if (typeof CloudDB !== 'undefined' && CloudDB.isReady()) {
                await CloudDB.terminateAndClearData();
                console.log('✅ Cloud data wiped.');
            }

            // 2. Clear Local Storage & Session Storage
            localStorage.clear();
            sessionStorage.clear();

            // 3. Clear IndexedDB (Large PDFs)
            if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
                indexedDB.deleteDatabase('DanatContractsDB');
                indexedDB.deleteDatabase('DanaSchoolsDB'); // Older name just in case
            }

            // 4. Force Reload
            alert('✅ تم تصفير النظام بالكامل (محلي وسحابي). سيتم توفير الصفحة الآن للبدء من جديد.');
            window.location.reload();
        } catch (err) {
            console.error('Wipe error:', err);
            alert('حدث خطأ أثناء مسح البيانات: ' + err.message + '\nسيتم محاولة تصفير البيانات المحلية على الأقل.');
            localStorage.clear();
            window.location.reload();
        }
    }
};

window.UI = UI;
const db = new DatabaseManager();
window.db = db;

// Global DB Actions
window.DB = {
    clearAllData: () => {
        if (confirm('⛔ تحذير أمني هام ⛔\n\nأنت على وشك حذف جميع البيانات من هذا المتصفح.\n\nهل قمت بأخذ نسخة احتياطية (System Snapshot)؟\n\nاضغط "موافق" فقط إذا كنت متأكداً من رغبتك في تصفير النظام بالكامل.')) {
            if (confirm('تأكيد نهائي: سيتم مسح بيانات الطلاب، العقود، والإعدادات.\n\nهل أنت متأكد 100%؟')) {
                console.log('🧨 Performing Factory Reset...');
                localStorage.clear();

                // Optional: Clear Cloud if needed, but usually we just unlink local.
                // Let's keep cloud safe, just clear local.

                UI.showNotification('✅ تم مسح كافة البيانات بنجاح');
                setTimeout(() => window.location.reload(), 1000);
            }
        }
    }
};

// Global Helper
window.markAsSigned = (id) => UI.markAsSigned(id);

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('App Initializing...');

    // 1. Initial Render
    UI.checkLogin(); // Check if already logged in
    UI.initTheme();  // Initialize Dark Mode
    UI.applyBranding(); // Apply school identity

    // 2. Tab Navigation logic (Combined Desktop & Mobile)
    const allNavLinks = document.querySelectorAll('.nav-link, .mobile-nav-item');
    const pages = document.querySelectorAll('.page');

    allNavLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            try {
                e.preventDefault();
                const pageId = link.dataset.page;
                if (!pageId) return;

                // 1. Remove active state from ALL links (top and bottom)
                allNavLinks.forEach(l => l.classList.remove('active'));

                // 2. Add active state to all links matching this page (Sync desktop/mobile)
                document.querySelectorAll(`[data-page="${pageId}"]`).forEach(l => l.classList.add('active'));

                // 3. Switch page
                pages.forEach(p => p.classList.remove('active'));
                const targetPage = document.getElementById(`${pageId}-page`);
                if (targetPage) targetPage.classList.add('active');

                // 4. Load page-specific data
                if (pageId === 'dashboard' || pageId === 'students') {
                    UI.renderStudents();
                    UI.updateStats();
                } else if (pageId === 'settings') {
                    UI.loadSettingsPage();
                }

                // 5. Scroll to top when switching pages on mobile
                window.scrollTo(0, 0);

            } catch (err) { console.error('Navigation Error:', err); }
        });
    });

    // 3. Modal Events
    const newStudentBtn = document.getElementById('newStudentBtn');
    if (newStudentBtn) {
        newStudentBtn.addEventListener('click', () => UI.openModal());
    }

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => UI.closeModal());
    }

    const closeModalBtn = document.querySelector('.close-modal'); // Might be ID
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => UI.closeModal());
    const closeBtn2 = document.getElementById('closeModalBtn');
    if (closeBtn2) closeBtn2.addEventListener('click', () => UI.closeModal());

    // 4. Select All Logic
    const setupSelectAll = (headerId, bodyId) => {
        const header = document.getElementById(headerId);
        if (!header) return;
        header.addEventListener('change', () => {
            const checks = document.querySelectorAll(`#${bodyId} .student-checkbox`);
            checks.forEach(c => c.checked = header.checked);
            UI.handleSelectionChange();
        });
    };
    setupSelectAll('selectAllAllStudents', 'allStudentsTableBody');

    // 6. Auto-select contract on track change
    const studentTrackSelect = document.getElementById('studentTrack');
    if (studentTrackSelect) {
        studentTrackSelect.addEventListener('change', () => UI.autoSelectContract());
    }

    // 5. Search & Filter Logic (Standardized)
    const searchInputs = ['studentSearch', 'studentSearchAll'];
    searchInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => UI.applyFilters());
    });

    // Search for Signed Contracts
    const signedContractSearch = document.getElementById('signedContractSearch');
    if (signedContractSearch) {
        signedContractSearch.addEventListener('input', (e) => {
            UI.renderSignedContracts(e.target.value);
        });
    }

    const studentForm = document.getElementById('studentForm');
    if (studentForm) {
        studentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const editingId = studentForm.dataset.editingId;
            const existingStudent = editingId ? db.getStudents().find(s => String(s.id) === String(editingId)) : null;

            // Start with existing custom fields if editing, or an empty object
            const customFields = existingStudent?.customFields ? { ...existingStudent.customFields } : {};

            // Get values from all custom fields defined in settings
            const settings = db.getSettings();
            (settings.customFields || []).forEach(f => {
                const el = document.getElementById(`custom_${f.id}`);
                if (el) customFields[f.id] = el.value;
            });

            // Explicitly get values from hardcoded form fields and add/overwrite them in customFields
            const explicitIdEl = document.getElementById('explicitNationalId');
            if (explicitIdEl) customFields['nationalId'] = explicitIdEl.value;

            // Capture Parent National ID
            const parentIdEl = document.getElementById('parentNationalId');
            if (parentIdEl) customFields['parentNationalId'] = parentIdEl.value;

            const trackEl = document.getElementById('studentTrack');
            if (trackEl) customFields['studentTrack'] = trackEl.value;

            // Now build the final student object
            const studentData = {
                // Start with existing data to preserve signature, etc.
                ...(existingStudent || {}),

                // Overwrite with fresh data from the form
                id: editingId || Date.now().toString(),
                studentName: document.getElementById('studentName').value,
                studentLevel: document.getElementById('studentLevel').value,
                studentGrade: document.getElementById('studentGrade').value,
                parentName: document.getElementById('parentName').value,
                parentEmail: document.getElementById('parentEmail').value,
                parentWhatsapp: document.getElementById('parentWhatsapp').value,
                contractYear: document.getElementById('contractYear')?.value || new Date().getFullYear().toString(),
                contractTemplateId: document.getElementById('contractTemplate')?.value || '',
                sendMethod: document.getElementById('sendMethod')?.value || 'whatsapp',
                registrationType: document.getElementById('registrationType')?.value || 'existing',
                studentNationality: document.getElementById('studentNationality')?.value || 'سعودي',

                // Add the collected custom fields object
                customFields: customFields,

                // Set default status/date if it's a new student, otherwise keep existing
                contractStatus: existingStudent?.contractStatus || 'pending',
                createdAt: existingStudent?.createdAt || new Date().toISOString()
            };

            await db.saveStudent(studentData); // Await async save
            UI.closeModal();
            UI.renderStudents();
            UI.updateStats();
            UI.showNotification(editingId ? '✅ تم تحديث بيانات الطالب' : '✅ تم تسجيل الطالب بنجاح');
        });
    }

    // Initialize PDF Template Editor Resources
    const initPdfEditorVars = () => {
        const list = document.getElementById('pdfVariablesList');
        if (!list) return;

        // Clear only custom/dynamic buttons if we had a marker, but here we just append if not exists
        // Actually, let's just ensure we append custom fields
        const settings = db.getSettings();
        const customFields = settings.customFields || [];

        // Remove existing custom vars to prevent dupes
        list.querySelectorAll('.var-btn-custom').forEach(b => b.remove());

        // Add Custom Fields
        customFields.forEach(field => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'var-btn var-btn-custom';
            btn.dataset.var = `{${field.label}}`;
            btn.textContent = field.label;
            // Insert before the special image fields or at end
            list.insertBefore(btn, list.querySelector('[data-var="{التوقيع}"]') || null);
        });

        // Re-attach listeners for new buttons if needed (event delegation is better but sticking to current pattern)
        // If current pattern is delegation on parent, we are good.
        // Let's check how clicks are handled. 
        // Logic seems to be in ContractManager or inline? 
        // There was no evident inline click handler in HTML view.
        // Let's add delegation here to be safe.
    };

    // Call this when opening the editor
    const pdfUploadInput = document.getElementById('pdfTemplateInput');
    if (pdfUploadInput) {
        pdfUploadInput.addEventListener('change', () => setTimeout(initPdfEditorVars, 500));
    }
    // Expose for manual refresh if needed
    window.refreshPdfVariables = initPdfEditorVars;

    // Also on page load just in case
    initPdfEditorVars();


    // Event Delegation for Variable Buttons (to fix potential non-working buttons)
    document.getElementById('pdfVariablesList')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('var-btn')) {
            const variable = e.target.dataset.var;
            if (typeof ContractUI !== 'undefined' && ContractUI.handleVariableClick) {
                ContractUI.handleVariableClick(variable);
            } else {
                console.warn('ContractUI not ready');
            }
        }
    });

    // Close dropdowns when clicking outside or after selecting an item
    document.addEventListener('click', (e) => {
        // Close if click is outside action-group
        if (!e.target.closest('.action-group')) {
            document.querySelectorAll('.action-dropdown-menu').forEach(m => {
                m.classList.remove('active');
                m.style.display = 'none';
            });
        }

        // Close if click is ON an item inside the menu
        if (e.target.closest('.action-dropdown-item')) {
            const menu = e.target.closest('.action-dropdown-menu');
            if (menu) {
                menu.classList.remove('active');
                menu.style.display = 'none';
            }
        }
    });

    console.log('App Started Successfully');
});
