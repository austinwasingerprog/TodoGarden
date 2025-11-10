import Swal from 'sweetalert2';

// onAdd: function(text) => void
export class WeedDialog {
    constructor(weed) {
        this.weed = weed;
    }
    
    async open() {
        if (!weed) return;
        if (this._activeWeedDialog) return;

        // helper to escape user text into HTML inputs
        const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // populate initial values
        const initTitle = esc(weed.text || '');
        const initDue = (weed.due) ? (new Date(weed.due).toISOString().slice(0,10)) : '';
        const initDesc = esc(weed.description || '');
        const initDoneAttr = weed.completed ? 'checked' : '';

        // mark modal open so main loop can disable movement
        window.gameModalOpen = true;

        const html = `
            <input id="swal-title" class="swal2-input" placeholder="Title" value="${initTitle}">
            <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin:6px 0">
                <label style="font-size:13px"><input id="swal-done" type="checkbox" ${initDoneAttr}> Done</label>
                <input id="swal-due" type="date" style="width:48%" value="${initDue}">
            </div>
            <textarea id="swal-desc" class="swal2-textarea" placeholder="Description" style="min-height:96px">${initDesc}</textarea>
        `;

        this._activeWeedDialog = true;
        Swal.fire({
            title: 'Edit task',
            html,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save',
            allowOutsideClick: false,
            willClose: () => { window.gameModalOpen = false; this._activeWeedDialog = null; }
        }).then((result) => {
            window.gameModalOpen = false;
            this._activeWeedDialog = null;
            if (result.isConfirmed) {
                try {
                    const titleEl = document.getElementById('swal-title');
                    const doneEl = document.getElementById('swal-done');
                    const dueEl = document.getElementById('swal-due');
                    const descEl = document.getElementById('swal-desc');

                    weed.text = titleEl ? titleEl.value : weed.text;
                    weed.completed = doneEl ? Boolean(doneEl.checked) : Boolean(weed.completed);
                    weed.due = (dueEl && dueEl.value) ? new Date(dueEl.value).toISOString() : null;
                    weed.description = descEl ? descEl.value : (weed.description || '');

                    // refresh visuals
                    try { if (weed.label) weed.label.text = weed.text; } catch (e) {}
                    try { if (weed.check) weed.check.visible = !!weed.completed; } catch (e) {}
                    try { if (weed.strike) weed.strike.visible = !!weed.completed; } catch (e) {}

                    if (weed.completed) this._bloom(weed);
                    try { this._save(); } catch (e) {}
                } catch (e) { /* defensive */ }
            }
        }).catch(() => {
            window.gameModalOpen = false;
            this._activeWeedDialog = null;
        });
    }
}

export default WeedDialog;
