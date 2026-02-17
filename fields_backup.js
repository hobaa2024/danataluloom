/**
 * Extracted Custom Fields Logic from script.js
 * Source: Uploaded script.js (Version with National ID support)
 * Date: 2026-01-26
 */

// 1. Database Defaults (Includes 'nationalId')
// Located in DatabaseManager.getSettings()
const defaultSettings = {
    // ... other settings ...
    customFields: [
        { id: 'nationalId', label: 'رقم الهوية', type: 'number' }
    ]
};

// 2. Render Form Fields (For Student Modal)
// Located in UI.renderStudentFormFields()
function renderStudentFormFields(student = null) {
    const container = document.getElementById('dynamicCustomFieldsContainer');
    if (!container) return;

    const settings = db.getSettings();
    const fields = settings.customFields || [];

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
}

// 3. Render Fields in Contract Summary (PDF/HTML)
// Located in UI.getContractSummaryHTML()
function renderFieldsInSummary(student, settings) {
    if (!student.customFields || Object.keys(student.customFields).length === 0) return '';

    let rows = '';
    const fields = settings.customFields || [];
    const entries = Object.entries(student.customFields);

    for (let i = 0; i < entries.length; i += 2) {
        const [key1, val1] = entries[i];
        const label1 = fields.find(f => f.id == key1)?.label || key1;

        const [key2, val2] = entries[i + 1] || [];
        const label2 = key2 ? (fields.find(f => f.id == key2)?.label || key2) : '';

        rows += `<tr>
                    <td style="font-weight:bold; padding:15px 0 8px;">${label1}:</td>
                    <td style="border-bottom:1px solid #e2e8f0;">${val1}</td>
                    ${key2 ? `<td style="font-weight:bold; padding:15px 0 8px;">${label2}:</td><td style="border-bottom:1px solid #e2e8f0;">${val2}</td>` : '<td></td><td></td>'}
                </tr>`;
    }
    return rows;
}

// 4. Settings Management (Add/Delete/Render)
// Located in UI object
const settingsLogic = {
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

        fields = fields.filter(f => f.id !== id);
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
                <button class="btn btn-icon btn-danger" onclick="UI.deleteCustomField(${f.id})" style="width:30px; height:30px; min-width:30px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `).join('') : '<div class="chip-empty">لا توجد حقول إضافية</div>';
    }
};
