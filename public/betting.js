document.querySelectorAll('.bet-place').forEach(form => {
    const amount = form.elements.amount;
    if (!amount) return;
    amount.addEventListener('input', () => {
        let value = '0';
        if (/^\d+$/.test(amount.value)) value = (BigInt(amount.value) * BigInt(form.dataset.odds) / 100n).toString();
        form.querySelector('.bet-preview').textContent = value;
    });
});
document.querySelectorAll('[data-event-form]').forEach(form => {
    const input = form.querySelector('[data-deadline]');
    if (input.dataset.initial) {
        const date = new Date(input.dataset.initial);
        const local = new Date(date.getTime() + 3 * 60 * 60 * 1000);
        input.value = local.toISOString().slice(0, 16);
    }
    form.addEventListener('submit', () => { form.elements.closesAt.value = input.value ? new Date(input.value + ':00+03:00').toISOString() : ''; });
});
document.querySelectorAll('.betting form[method="post"]').forEach(form => {
    form.addEventListener('submit', () => { form.querySelectorAll('button').forEach(button => { button.disabled = true; }); });
});
