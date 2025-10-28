import Swal from 'sweetalert2';

// onAdd: function(text) => void
export class Dialog {
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
            focusConfirm: false,
            allowEnterKey: true,
            preConfirm: (v) => {
                if (!v || !v.trim()) {
                    Swal.showValidationMessage('Please enter text');
                    return false;
                }
                return v.trim();
            }
        });

        if (text && this.onAdd) {
            this.onAdd(text);
        }
    }
}

export default Dialog;