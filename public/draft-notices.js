(() => {
    const active = new Map();

    window.showDraftNotice = (message, kind = 'info') => {
        const value = String(message ?? '').trim();
        if (!value) return;
        const type = ['error', 'success', 'info'].includes(kind) ? kind : 'info';
        const key = `${type}:${value}`;
        if (active.has(key)) return;

        let stack = document.getElementById('draft-notice-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'draft-notice-stack';
            stack.className = 'draft-notice-stack';
            document.body.appendChild(stack);
        }

        const notice = document.createElement('div');
        notice.className = 'draft-notice';
        notice.dataset.kind = type;
        notice.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = document.createElement('span');
        icon.className = 'draft-notice-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = type === 'error' ? '!' : type === 'success' ? '✓' : 'i';

        const body = document.createElement('span');
        body.className = 'draft-notice-message';
        body.textContent = value;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'draft-notice-close';
        close.setAttribute('aria-label', 'Close notification');
        close.textContent = '×';

        let timer;
        const dismiss = () => {
            clearTimeout(timer);
            active.delete(key);
            notice.remove();
        };
        close.addEventListener('click', dismiss);
        notice.append(icon, body, close);
        stack.prepend(notice);
        active.set(key, notice);
        while (stack.children.length > 3) stack.lastElementChild.querySelector('button').click();
        timer = setTimeout(dismiss, type === 'error' ? 9000 : 5500);
    };
})();
