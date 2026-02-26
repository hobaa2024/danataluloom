// Firebase Configuration for Dana Al-Oloom Schools
// ================================================
// 
// تم تحديث الإعدادات لربط المشروع الجديد
// التاريخ: 3 فبراير 2026
//
// ================================================

const firebaseConfig = {
    apiKey: "AIzaSyA3GLLj6aldf4wE83TyxY79C886j2RlYzc",
    authDomain: "danataluloom-schools-4c7f8.firebaseapp.com",
    databaseURL: "https://danataluloom-schools-4c7f8-default-rtdb.firebaseio.com",
    projectId: "danataluloom-schools-4c7f8",
    storageBucket: "danataluloom-schools-4c7f8.firebasestorage.app",
    messagingSenderId: "801441736400",
    appId: "1:801441736400:web:f860b5a553f6122a81e0d5"
};

// Check if Firebase is configured
const isFirebaseConfigured = firebaseConfig.apiKey && firebaseConfig.databaseURL;

let firebaseDb = null;

// Initialize Firebase if configured
if (isFirebaseConfigured) {
    if (typeof firebase === 'undefined') {
        console.error('❌ Error: Firebase scripts were NOT loaded. Check your internet or firewall.');
        if (typeof UI !== 'undefined' && UI.showNotification) {
            alert('⚠️ لم يتم تحميل مكتبات Firebase! يبدو أن الإنترنت ضعيف أو مغلق في مدرستك. حاول استخدام شبكة بيانات الجوال.');
        }
    } else {
        try {
            firebase.initializeApp(firebaseConfig);
            firebaseDb = firebase.database();
            console.log('✅ Firebase initialized successfully');

            // Check for immediate connection failures
            firebaseDb.ref(".info/connected").on("value", (snap) => {
                if (snap.val() === true) {
                    console.log("☁️ Real-time Connection Established");
                } else {
                    console.warn("☁️ Connection lost or waiting...");
                }
            });
        } catch (e) {
            console.error('Firebase initialization error:', e);
            alert('❌ خطأ في تهيئة Firebase: ' + e.message);
        }
    }
} else {
    console.warn('⚠️ Firebase not configured. Using localStorage only.');
}

// Cloud Database Manager
const CloudDB = {
    // Save student data to Firebase
    saveStudent(student) {
        if (!firebaseDb) return Promise.resolve(false);

        return firebaseDb.ref('students/' + student.id).set(student)
            .then(() => {
                console.log('☁️ Student saved to cloud:', student.studentName);
                return true;
            })
            .catch(err => {
                console.error('Cloud save error:', err);
                return false;
            });
    },

    // Update student status and contract data
    updateContract(studentId, data) {
        if (!firebaseDb) return Promise.resolve(false);

        return firebaseDb.ref('students/' + studentId).update(data)
            .then(() => {
                console.log('☁️ Contract updated in cloud for:', studentId);
                return true;
            })
            .catch(err => {
                console.error('Cloud update error:', err);
                return false;
            });
    },

    // Get student by ID from Firebase
    getStudent(id) {
        if (!firebaseDb) return Promise.resolve(null);

        return firebaseDb.ref('students/' + id).once('value')
            .then(snapshot => snapshot.val())
            .catch(err => {
                console.error('Cloud fetch student error:', err);
                return null;
            });
    },

    // Get all students from Firebase
    getStudents() {
        if (!firebaseDb) return Promise.resolve([]);

        return firebaseDb.ref('students').once('value')
            .then(snapshot => {
                const data = snapshot.val();
                if (!data) return [];
                return Object.values(data);
            })
            .catch(err => {
                console.error('Cloud fetch error:', err);
                throw err;
            });
    },

    // Listen for real-time updates
    listenForUpdates(callback, errorCallback) {
        if (!firebaseDb) return;

        firebaseDb.ref('students').on('value', snapshot => {
            const data = snapshot.val();
            const students = data ? Object.values(data) : [];
            console.log('☁️ Real-time update received:', students.length, 'students');
            callback(students);
        }, (error) => {
            console.error('Cloud listen error:', error);
            if (errorCallback) errorCallback(error);
        });
    },

    // Monitor connection state
    monitorConnection(callback) {
        if (!firebaseDb) return;
        firebaseDb.ref(".info/connected").on("value", (snap) => {
            callback(!!snap.val());
        });
    },

    runHealthCheck() {
        if (!firebaseDb) return Promise.reject({ code: 'NO_FIREBASE', message: 'Firebase not configured' });

        const healthRef = firebaseDb.ref('health_check/' + Date.now());

        return healthRef.set('ping')
            .then(() => {
                // If set is successful, remove the test data
                return healthRef.remove();
            })
            .then(() => {
                // If remove is successful, permissions are OK
                return { success: true };
            })
            .catch(err => {
                // Any failure in set/remove likely means a permission issue
                return Promise.reject(err);
            });
    },
    // Sync local data to cloud (admin use)
    syncLocalToCloud() {
        if (!firebaseDb) {
            console.warn('Firebase not configured');
            return Promise.resolve(false);
        }

        const localStudents = JSON.parse(localStorage.getItem('students') || '[]');
        const updates = {};

        localStudents.forEach(student => {
            updates['students/' + student.id] = student;
        });

        return firebaseDb.ref().update(updates)
            .then(() => {
                console.log('☁️ Local data synced to cloud:', localStudents.length, 'students');
                return true;
            })
            .catch(err => {
                console.error('Sync error:', err);
                throw err;
            });
    },

    // Sync cloud data to local (admin use)
    syncCloudToLocal() {
        return this.getStudents().then(students => {
            if (students.length > 0) {
                localStorage.setItem('students', JSON.stringify(students));
                console.log('☁️ Cloud data synced to local:', students.length, 'students');
                return true;
            }
            return false;
        });
    },

    // Check if Firebase is ready
    isReady() {
        return !!firebaseDb;
    },

    // Delete student from Cloud
    deleteStudent(id) {
        if (!firebaseDb) return Promise.resolve(false);
        return firebaseDb.ref('students/' + id).remove()
            .then(() => {
                console.log('☁️ Student deleted from cloud:', id);
                return true;
            })
            .catch(err => {
                console.error('Cloud delete error:', err);
                return false;
            });
    },

    // --- CONTRACT TEMPLATES CLOUD SYNC ---

    // Listen for settings real-time update
    listenForSettings(callback) {
        if (!firebaseDb) return;
        firebaseDb.ref('settings/appSettings').on('value', snapshot => {
            const data = snapshot.val();
            // Always callback even if null (to allow sync of resets)
            console.log('☁️ Settings real-time update received');
            callback(data);
        });
    },

    saveSettings(settings) {
        if (!firebaseDb) return Promise.resolve(false);

        // Save the entire settings object to a known path
        return firebaseDb.ref('settings/appSettings').set(settings)
            .then(() => {
                console.log('☁️ Settings saved to cloud.');
                return true;
            })
            .catch(err => {
                console.error('Cloud settings save error:', err);
                return false;
            });
    },
    saveContractTemplate(template) {
        if (!firebaseDb) return Promise.resolve(false);
        // We only save the essential template info. 
        // Note: Full PDF data might be large, but RTDB handles up to 10MB per leaf. 
        // Base64 PDFs are usually 1-3MB, so it should be fine.
        return firebaseDb.ref('templates/' + template.id).set(template)
            .then(() => {
                console.log('☁️ Template saved to cloud:', template.title);
                return true;
            })
            .catch(err => {
                console.error('Template cloud save error:', err);
                return false;
            });
    },

    deleteContractTemplate(id) {
        if (!firebaseDb) return Promise.resolve(false);
        return firebaseDb.ref('templates/' + id).remove()
            .then(() => {
                console.log('☁️ Template deleted from cloud:', id);
                return true;
            })
            .catch(err => {
                console.error('Template cloud delete error:', err);
                return false;
            });
    },

    getContractTemplate(id) {
        if (!firebaseDb) return Promise.resolve(null);
        return firebaseDb.ref('templates/' + id).once('value')
            .then(snapshot => snapshot.val())
            .catch(err => {
                console.error('Cloud fetch template error:', err);
                return null;
            });
    },

    // Listen for templates real-time update
    listenForTemplates(callback) {
        if (!firebaseDb) return;
        firebaseDb.ref('templates').on('value', snapshot => {
            const data = snapshot.val();
            const templates = data ? Object.values(data) : [];
            console.log('☁️ Templates real-time update received:', templates.length);
            callback(templates);
        });
    },

    getContractTemplates() {
        if (!firebaseDb) return Promise.resolve([]);
        return firebaseDb.ref('templates').once('value')
            .then(snapshot => {
                const data = snapshot.val();
                if (!data) return [];
                return Object.values(data);
            })
            .catch(err => {
                console.error('Cloud fetch templates error:', err);
                return [];
            });
    },
    // --- FONT STORAGE SYNC ---
    saveFont(id, fontData) {
        if (!firebaseDb) return Promise.resolve(false);
        return firebaseDb.ref('fonts/' + id).set(fontData)
            .then(() => {
                console.log('☁️ Font saved to cloud:', id);
                return true;
            })
            .catch(err => {
                console.error('Font cloud save error:', err);
                return false;
            });
    },

    getFont(id) {
        if (!firebaseDb) return Promise.resolve(null);
        return firebaseDb.ref('fonts/' + id).once('value')
            .then(snapshot => snapshot.val())
            .catch(err => {
                console.error('Cloud fetch font error:', err);
                return null;
            });
    },

    // --- DANGER ZONE: WIPE ALL DATA ---
    terminateAndClearData() {
        if (!firebaseDb) return Promise.reject({ message: 'Firebase not configured' });

        console.warn('⚠️ WARNING: Wiping ALL data from cloud...');

        // Remove everything except fonts (they are heavy and usually safe to keep)
        const updates = {};
        updates['students'] = null;
        updates['templates'] = null;
        updates['settings'] = null;
        updates['signatures'] = null; // Just in case they are stored here
        updates['backups'] = null;    // If any backups were saved to cloud

        return firebaseDb.ref().update(updates)
            .then(() => {
                console.log('✅ Cloud data wiped successfully.');
                return true;
            })
            .catch(err => {
                console.error('Cloud wipe error:', err);
                // Last resort: try individual removes
                return firebaseDb.ref('students').remove()
                    .then(() => firebaseDb.ref('templates').remove())
                    .then(() => firebaseDb.ref('settings').remove())
                    .then(() => firebaseDb.ref('signatures').remove())
                    .then(() => firebaseDb.ref('backups').remove())
                    .then(() => true);
            });
    }
};

// Make available globally
window.CloudDB = CloudDB;
window.isFirebaseConfigured = isFirebaseConfigured;
