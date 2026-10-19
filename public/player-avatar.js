(function (root) {
    const defaultAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    function renderPlayerAvatar(image, { taken, discordId, avatar }) {
        if (!taken || !discordId) {
            image.style.display = 'none';
            image.removeAttribute('src');
            delete image.dataset.avatarKey;
            image.onerror = null;
            return;
        }

        const url = avatar
            ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${encodeURIComponent(avatar)}.png`
            : defaultAvatar;
        image.style.display = 'block';
        if (image.dataset.avatarKey === url) return;
        image.dataset.avatarKey = url;
        image.alt = 'Player avatar';
        image.onerror = () => {
            if (image.getAttribute('src') !== defaultAvatar) image.src = defaultAvatar;
            else {
                image.onerror = null;
                image.src = '/logo.png';
            }
        };
        image.src = url;
    }

    root.renderPlayerAvatar = renderPlayerAvatar;
    if (typeof module !== 'undefined' && module.exports) module.exports = { renderPlayerAvatar };
})(typeof window !== 'undefined' ? window : globalThis);
