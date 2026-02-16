// --- ПРОСМОТР ТУРНИРА (ОБНОВЛЕННЫЙ) ---
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');

        // Ищем матчи этого турнира
        const matches = await Match.find({ tournamentSlug: tour.slug }).sort({ date: -1 });

        res.render('pages/tournament_view', { 
            title: tour.title, 
            tour: tour, 
            matches: matches 
        });
    } catch (e) {
        res.redirect('/tournaments');
    }
});

// --- АДМИН: УПРАВЛЕНИЕ ТУРНИРОМ ---
router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour });
});

// --- АДМИН: СОХРАНИТЬ ССЫЛКИ (Регламенты) ---
router.post('/admin/update-links', urlencodedParser, async (req, res) => {
    try {
        await Tournament.updateOne(
            { slug: req.body.slug },
            { 
                regLink: req.body.regLink,
                rulesLinkRu: req.body.rulesLinkRu,
                rulesLinkEn: req.body.rulesLinkEn
            }
        );
        res.redirect('/admin/manage/' + req.body.slug);
    } catch(e) { res.send(e.message); }
});

// --- АДМИН: ДОБАВИТЬ ПОСТ (Как в ТГ) ---
router.post('/admin/announce', upload.single('image'), async (req, res) => {
    try {
        let filename = null;
        if (req.file) filename = req.file.filename;

        await Tournament.updateOne(
            { slug: req.body.slug },
            { 
                $push: { 
                    announcements: { 
                        text: req.body.text, 
                        image: filename,
                        date: new Date() 
                    } 
                } 
            }
        );
        res.redirect('/admin/manage/' + req.body.slug);
    } catch (e) { res.send(e.message); }
});

// --- АДМИН: ПРИВЯЗАТЬ МАТЧ ---
router.post('/admin/link-match', urlencodedParser, async (req, res) => {
    const match = await Match.findOne({ roomId: req.body.roomId.toUpperCase() });
    if (match) { 
        match.tournamentSlug = req.body.slug; 
        await match.save(); 
        res.redirect('/admin/manage/' + req.body.slug); 
    } else { 
        res.send(`Match not found!`); 
    }
});
