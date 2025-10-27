import Swal from 'sweetalert2';

// Simple dialog that returns the text to a caller-provided callback.
// Do NOT import or construct WeedManager here (avoids circular import).
export class Dialog {
    // onAdd: function(text) => void
    constructor(onAdd) {
        this.onAdd = onAdd;
    }

    async open() {
        const { value: text } = await Swal.fire({
            title: 'Add a Weed',
            input: 'text',
            inputPlaceholder: 'Enter to-do text...',
            showCancelButton: true,
            confirmButtonText: 'Add',
            preConfirm: (v) => v && v.trim() ? v.trim() : Promise.reject('Please enter text'),
        });

        if (text && this.onAdd) {
            this.onAdd(text);
        }
    }
}