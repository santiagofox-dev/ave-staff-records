/**
 * GRUPO AVE - LANDING PAGE INTERACTIVE ENGINE
 * Plain JS (ES6+) - Clean, CSP Compliant, No External JS Dependencies
 */

document.addEventListener('DOMContentLoaded', () => {

    // --------------------------------------------------------------------------
    // 1. BILINGUAL DICTIONARY & I18N ENGINE (ES/EN) WITH LOCALSTORAGE TRY/CATCH
    // --------------------------------------------------------------------------
    const i18n = {
        es: {
            'nav.about': 'Nosotros',
            'nav.tech': 'Tecnología',
            'nav.services': 'Servicios',
            'nav.certs': 'Calidad',
            'nav.coverage': 'Cobertura',
            'nav.portal': 'Portal',
            'nav.proposal': 'Solicitar propuesta',

            'hero.badge': 'Comedores industriales para maquiladoras',
            'hero.title': 'Ingeniería en bienestar para colaboradores a través de tecnología y nutrición.',
            'hero.subhead': 'Convertimos el comedor de su planta en un beneficio real para sus colaboradores: menús balanceados diseñados por nutriólogos, inocuidad certificada y operación transparente en tiempo real.',
            'hero.ctaPrimary': 'Solicitar propuesta',
            'hero.ctaSecondary': 'Ver cómo trabajamos',

            'logos.title': 'Confían en nosotros',

            'numbers.serviciosLabel': 'servicios diarios',
            'numbers.serviciosSub': 'JABIL ≈2,950 · APTIV ≈4,300 · Versigent ≈4,300',
            'numbers.recetasLabel': 'recetas diseñadas',
            'numbers.recetasSub': 'Diseñadas por nutriólogos',
            'numbers.estadosLabel': 'estados activos',
            'numbers.estadosSub': 'Chihuahua, Coahuila, Jalisco, Baja California',
            'numbers.gasLabel': 'menos consumo de gas',
            'numbers.gasSub': 'Con hornos inteligentes UNOX',
            'numbers.seguroLabel': 'seguro de responsabilidad civil',
            'numbers.seguroSub': 'Cobertura operativa integral',
            'numbers.aniosLabel': 'fundada',
            'numbers.aniosSub': 'Más de ocho años operando comedores industriales',

            'whatwedo.subtitle': 'Propuesta Gastronómica',
            'whatwedo.title': 'Alimentación balanceada adaptada al ritmo de su planta',
            'whatwedo.c1Title': 'Menús Nutricionales Balanceados',
            'whatwedo.c1Desc': 'Menús diseñados por nutriólogos y balanceados calóricamente para sostener el desempeño físico y la energía del personal.',
            'whatwedo.c2Title': 'Desayuno, comida y cena en todos los turnos',
            'whatwedo.c2Desc': 'Servicio completo optimizado para los horarios de cada turno de la planta.',
            'whatwedo.c3Title': 'Opciones Vegetarianas, Veganas y Diabéticas',
            'whatwedo.c3Desc': 'Alternativas vegetarianas, veganas y aptas para diabéticos, siempre disponibles.',
            'whatwedo.c4Title': 'Línea Saludable Diaria',
            'whatwedo.c4Desc': 'Un platillo saludable y rotativo disponible todos los días.',

            'tech.subtitle': 'Innovación en Cocina Industrial',
            'tech.title': 'Tecnología operativa de vanguardia',
            'tech.dashBadge': 'Monitoreo en Tiempo Real',
            'tech.dashTitle': 'Dashboard Operativo de Planta',
            'tech.dashDesc': 'Seguimiento digital de los estándares de higiene y del inventario PEPS (primeras entradas, primeras salidas), con evidencia fotográfica obligatoria en cada tarea crítica. Su equipo tiene acceso en tiempo real para verificar la ejecución.',
            'tech.statusLive': 'Ejemplo · Turno 1 en curso',
            'tech.task1': 'Temperatura de línea caliente registrada',
            'tech.task2': 'Foto de limpieza de área cargada',
            'tech.unoxBadge': 'Eficiencia Energética',
            'tech.unoxTitle': 'Hornos Inteligentes UNOX',
            'tech.unoxDesc': 'Un solo horno UNOX reemplaza hasta cuatro equipos de gas tradicionales (freír, rostizar, vapor). Su tecnología SMART.Energy detecta hornos vacíos o poca carga y reduce el consumo automáticamente.',
            'tech.unoxStat1': 'Equipos de gas reemplazados',
            'tech.unoxStat2': 'Uso intensivo promedio',

            'tech.cncTitle': 'Proceso Cook & Chill en 3 Etapas',
            'tech.cncSub': 'Seguridad a escala: cada platillo pasa por el mismo proceso controlado.',
            'tech.cncStep1Title': 'Cocción de precisión',
            'tech.cncStep1Desc': 'Hornos inteligentes que mantienen con precisión la humedad, el sabor y la temperatura interna objetivo.',
            'tech.cncStep2Title': 'Abatimiento rápido',
            'tech.cncStep2Desc': 'Enfriamiento inmediato que detiene el crecimiento bacteriano y asegura la máxima inocuidad.',
            'tech.cncStep3Title': 'Regeneración',
            'tech.cncStep3Desc': 'Recalentamiento preciso que devuelve la temperatura y textura exactas al momento del servicio.',

            'digital.subtitle': 'Experiencia Digital para Comensales',
            'digital.title': 'Order & Pick Up App + Menú Interactivo',
            'digital.desc': 'Herramientas digitales que hacen más ágil el tiempo de comida de sus colaboradores.',
            'digital.f1': 'App “Order & Pick Up”: pedidos digitales, bowls personalizados y pago integrado.',
            'digital.f2': 'Menú semanal interactivo: el personal ve y programa sus opciones con anticipación.',
            'digital.f3': 'Disponible para las líneas de servicio tradicionales.',
            'digital.widgetTitle': 'Selector de Menú Semanal',
            'digital.widgetLive': 'Menú de ejemplo',

            'beyond.subtitle': 'Servicios Complementarios',
            'beyond.title': 'Más allá del comedor industrial',
            'beyond.vendingTitle': 'Disponibilidad 24/7',
            'beyond.v1': 'Coffee shop y barra de snacks con bebidas preparadas y snacks frescos.',
            'beyond.v2': 'Vending tradicional: bebidas frías y snacks para todos los turnos.',
            'beyond.v3': 'Vending de pizza artesanal horneada al momento.',
            'beyond.v4': 'Smart vending de platillos congelados completos, listos para calentar.',
            'beyond.eventsTitle': 'Eventos corporativos',
            'beyond.e1': 'Box lunch y coffee breaks.',
            'beyond.e2': 'Servicio emplatado de 3 a 4 tiempos para cenas ejecutivas.',
            'beyond.e3': 'Buffets corporativos, food trucks y estaciones especiales.',
            'beyond.e4': 'Coctelería y canapés para eventos de networking.',

            'slider.subtitle': 'Transformación de Espacios',
            'slider.title': 'Transformamos el comedor',
            'slider.after': 'EL ESTÁNDAR GRUPO AVE',
            'slider.before': 'ANTES',
            'slider.caption': '"Elevamos el comedor de un servicio a un beneficio real para el empleado."',

            'certs.subtitle': 'Cumplimiento Legal y Normativo',
            'certs.title': 'Certificaciones y cumplimiento total',
            'certs.hDesc': 'Manejo higiénico y seguro de alimentos certificado.',
            'certs.nomDesc': 'Cumplimiento operativo total con las normas sanitarias nacionales.',
            'certs.isoDesc': 'Sistema de gestión de calidad con certificación internacional.',
            'certs.tifDesc': 'Uso exclusivo de proveedores de cárnicos con inspección federal.',
            'certs.repseDesc': 'Registro vigente para servicios especializados: cumplimiento legal total.',
            'certs.rcTitle': 'Seguro Responsabilidad Civil',
            'certs.rcDesc': 'Póliza de USD $1,000,000 con cobertura operativa integral.',

            'map.subtitle': 'Presencia Regional',
            'map.title': '4 Estados con Operación Activa',

            'contact.subtitle': 'Contacto Directo',
            'contact.title': 'Solicite una propuesta o visita a su planta',
            'contact.desc': 'Atención personalizada para gerentes de planta, recursos humanos y compras de la industria manufacturera.',
            'contact.wa': 'Enviar mensaje por WhatsApp',

            'form.name': 'Nombre completo *',
            'form.company': 'Empresa / Maquiladora *',
            'form.city': 'Ciudad de la Planta *',
            'form.headcount': 'Comensales Diarios Aprox. *',
            'form.message': 'Mensaje o requerimiento *',
            'form.submit': 'Enviar solicitud de propuesta',
            'form.note': 'Su cliente de correo predeterminado se abrirá con el correo dirigido a santiago.fox@gpoave.com',

            'footer.privacy': 'Aviso de Privacidad',
            'footer.rights': 'Todos los derechos reservados.'
        },
        en: {
            'nav.about': 'About Us',
            'nav.tech': 'Technology',
            'nav.services': 'Services',
            'nav.certs': 'Quality',
            'nav.coverage': 'Coverage',
            'nav.portal': 'Portal',
            'nav.proposal': 'Request proposal',

            'hero.badge': 'Industrial cafeterias for manufacturing plants',
            'hero.title': 'Engineering employee wellbeing through technology and nutrition.',
            'hero.subhead': 'We turn your plant cafeteria into a real benefit for your workforce: nutritionist-designed balanced menus, certified food safety and real-time operational transparency.',
            'hero.ctaPrimary': 'Request proposal',
            'hero.ctaSecondary': 'See how we work',

            'logos.title': 'Trusted by industry leaders',

            'numbers.serviciosLabel': 'daily meals served',
            'numbers.serviciosSub': 'JABIL ≈2,950 · APTIV ≈4,300 · Versigent ≈4,300',
            'numbers.recetasLabel': 'designed recipes',
            'numbers.recetasSub': 'Designed by nutritionists',
            'numbers.estadosLabel': 'active states',
            'numbers.estadosSub': 'Chihuahua, Coahuila, Jalisco, Baja California',
            'numbers.gasLabel': 'less gas consumption',
            'numbers.gasSub': 'With UNOX smart ovens',
            'numbers.seguroLabel': 'civil liability insurance',
            'numbers.seguroSub': 'Comprehensive operational coverage',
            'numbers.aniosLabel': 'founded',
            'numbers.aniosSub': 'Over eight years operating industrial cafeterias',

            'whatwedo.subtitle': 'Gastronomic Offering',
            'whatwedo.title': 'Balanced nutrition tailored to your plant operations',
            'whatwedo.c1Title': 'Balanced Nutritional Menus',
            'whatwedo.c1Desc': 'Nutritionist-designed, calorically balanced menus that sustain physical performance and worker energy.',
            'whatwedo.c2Title': 'Breakfast, lunch and dinner for every shift',
            'whatwedo.c2Desc': 'Full service optimized for every shift schedule in your plant.',
            'whatwedo.c3Title': 'Vegetarian, Vegan & Diabetic-Friendly',
            'whatwedo.c3Desc': 'Vegetarian, vegan and diabetic-friendly alternatives, always available.',
            'whatwedo.c4Title': 'Daily Healthy Line',
            'whatwedo.c4Desc': 'A dedicated, rotating healthy dish available every single day.',

            'tech.subtitle': 'Industrial Kitchen Innovation',
            'tech.title': 'Cutting-edge operational technology',
            'tech.dashBadge': 'Real-Time Monitoring',
            'tech.dashTitle': 'Plant Operations Dashboard',
            'tech.dashDesc': 'Digital tracking of hygiene standards and FIFO inventory, with mandatory photo evidence for every critical task. Your team gets real-time access to verify execution.',
            'tech.statusLive': 'Example · Shift 1 in progress',
            'tech.task1': 'Hot line temperature logged',
            'tech.task2': 'Area cleaning photo uploaded',
            'tech.unoxBadge': 'Energy Efficiency',
            'tech.unoxTitle': 'UNOX Smart Ovens',
            'tech.unoxDesc': 'One UNOX oven replaces up to four traditional gas units (frying, roasting, steaming). SMART.Energy technology detects empty ovens or low loads and throttles power automatically.',
            'tech.unoxStat1': 'Gas units replaced',
            'tech.unoxStat2': 'Average intensive use',

            'tech.cncTitle': '3-Step Cook & Chill Process',
            'tech.cncSub': 'Safety at scale: every dish goes through the same controlled process.',
            'tech.cncStep1Title': 'Precision cooking',
            'tech.cncStep1Desc': 'Intelligent ovens hold precise humidity, flavor and core temperature targets.',
            'tech.cncStep2Title': 'Blast chilling',
            'tech.cncStep2Desc': 'Rapid cooling immediately halts bacterial growth, ensuring maximum food safety.',
            'tech.cncStep3Title': 'Regeneration',
            'tech.cncStep3Desc': 'Precise reheating restores the exact temperature and texture right at the moment of service.',

            'digital.subtitle': 'Diner Digital Experience',
            'digital.title': 'Order & Pick Up App + Interactive Menu',
            'digital.desc': 'Digital tools that make mealtime faster and easier for your workforce.',
            'digital.f1': '“Order & Pick Up” app: digital ordering, custom bowls and seamless payment.',
            'digital.f2': 'Interactive weekly menu: staff preview and schedule their options in advance.',
            'digital.f3': 'Available for traditional service lines too.',
            'digital.widgetTitle': 'Weekly Menu Selector',
            'digital.widgetLive': 'Sample menu',

            'beyond.subtitle': 'Complementary Services',
            'beyond.title': 'Beyond the industrial cafeteria',
            'beyond.vendingTitle': '24/7 availability',
            'beyond.v1': 'Coffee shop & snack bar with crafted beverages and fresh snacks.',
            'beyond.v2': 'Traditional vending: cold drinks and quick snacks for every shift.',
            'beyond.v3': 'Hot, freshly baked artisanal pizza vending.',
            'beyond.v4': 'Smart vending of complete ready-to-heat frozen meals.',
            'beyond.eventsTitle': 'Corporate events',
            'beyond.e1': 'Box lunches & coffee breaks.',
            'beyond.e2': 'Plated 3–4 course service for executive dinners.',
            'beyond.e3': 'Corporate buffets, food trucks and specialty stations.',
            'beyond.e4': 'Cocktails & canapés for networking events.',

            'slider.subtitle': 'Space Transformation',
            'slider.title': 'We transform the dining hall',
            'slider.after': 'THE GRUPO AVE STANDARD',
            'slider.before': 'BEFORE',
            'slider.caption': '"We elevate the cafeteria from a basic service to a true employee benefit."',

            'certs.subtitle': 'Legal & Regulatory Compliance',
            'certs.title': 'Certifications & total compliance',
            'certs.hDesc': 'Certified hygienic and safe food handling.',
            'certs.nomDesc': 'Full operational compliance with national sanitary standards.',
            'certs.isoDesc': 'Internationally certified quality management system.',
            'certs.tifDesc': 'Exclusive use of federally inspected meat suppliers.',
            'certs.repseDesc': 'Active specialized-services registration: full legal compliance.',
            'certs.rcTitle': 'Civil Liability Insurance',
            'certs.rcDesc': 'USD $1,000,000 policy with comprehensive operational coverage.',

            'map.subtitle': 'Regional Footprint',
            'map.title': '4 States with Active Operations',

            'contact.subtitle': 'Direct Contact',
            'contact.title': 'Request a proposal or plant visit',
            'contact.desc': 'Personalized attention for plant managers, HR, and purchasing leads in manufacturing.',
            'contact.wa': 'Send WhatsApp Message',

            'form.name': 'Full Name *',
            'form.company': 'Company / Plant *',
            'form.city': 'Plant City *',
            'form.headcount': 'Approx. Daily Headcount *',
            'form.message': 'Message or Requirements *',
            'form.submit': 'Submit Proposal Request',
            'form.note': 'Your default email app will open pre-addressed to santiago.fox@gpoave.com',

            'footer.privacy': 'Privacy Notice',
            'footer.rights': 'All rights reserved.'
        }
    };

    let currentLang = 'es';
    try {
        const storedLang = localStorage.getItem('ave_lang');
        if (storedLang && (storedLang === 'es' || storedLang === 'en')) {
            currentLang = storedLang;
        }
    } catch (e) {
        console.warn('localStorage not accessible, defaulting to ES');
    }

    function setLanguage(lang) {
        currentLang = lang;
        try {
            localStorage.setItem('ave_lang', lang);
        } catch (e) {
            // Ignore if blocked by CSP / privacy settings
        }

        document.documentElement.lang = lang;
        const langIndicator = document.getElementById('lang-indicator');
        if (langIndicator) langIndicator.textContent = lang === 'es' ? 'ES / EN' : 'EN / ES';

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[lang] && i18n[lang][key]) {
                el.textContent = i18n[lang][key];
            }
        });

        // Refresh dynamic menu text
        updateMenuWidget(currentDay);
    }

    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
        langBtn.addEventListener('click', () => {
            setLanguage(currentLang === 'es' ? 'en' : 'es');
        });
    }



    // --------------------------------------------------------------------------
    // 2. MOBILE NAVIGATION TOGGLE
    // --------------------------------------------------------------------------
    const mobileBtn = document.getElementById('mobile-toggle-btn');
    const mainNav = document.getElementById('main-nav');

    if (mobileBtn && mainNav) {
        mobileBtn.addEventListener('click', () => {
            const expanded = mobileBtn.getAttribute('aria-expanded') === 'true';
            mobileBtn.setAttribute('aria-expanded', !expanded);
            mainNav.classList.toggle('active');
        });

        // Close mobile nav on link click
        mainNav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                mainNav.classList.remove('active');
                mobileBtn.setAttribute('aria-expanded', 'false');
            });
        });
    }


    // --------------------------------------------------------------------------
    // 3. NUMBERS COUNT-UP ANIMATION (INTERSECTION OBSERVER)
    // --------------------------------------------------------------------------
    const numberCards = document.querySelectorAll('.number-val');
    let animatedNumbers = false;

    function countUp(el) {
        if (el.hasAttribute('data-no-count')) return;
        const target = parseInt(el.getAttribute('data-target'), 10);
        const prefix = el.getAttribute('data-prefix') || '';
        const suffix = el.getAttribute('data-suffix') || '';
        const duration = 2000;
        const start = 0;
        const startTime = performance.now();

        function update(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out quad
            const current = Math.floor(progress * (2 - progress) * target);
            el.textContent = prefix + current.toLocaleString('en-US') + suffix;

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                el.textContent = prefix + target.toLocaleString('en-US') + suffix;
            }
        }

        requestAnimationFrame(update);
    }

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const numbersSection = document.getElementById('nosotros');
    if (numbersSection && 'IntersectionObserver' in window && !reduceMotion) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !animatedNumbers) {
                    animatedNumbers = true;
                    numberCards.forEach(card => countUp(card));
                }
            });
        }, { threshold: 0.2 });

        observer.observe(numbersSection);
    }


    // --------------------------------------------------------------------------
    // 4. COOK & CHILL STEP SEQUENCER ON SCROLL
    // --------------------------------------------------------------------------
    const cncSteps = document.querySelectorAll('.cnc-step');
    let currentCncStep = 0, cncTimer = null, cncUserChose = false;
    function showCncStep(i) {
        currentCncStep = i;
        cncSteps.forEach((s, k) => { s.classList.toggle('active', k === i); s.setAttribute('aria-pressed', String(k === i)); });
    }
    cncSteps.forEach((s, k) => s.addEventListener('click', () => { cncUserChose = true; clearInterval(cncTimer); showCncStep(k); }));
    const cncBox = document.getElementById('como-trabajamos');
    if (cncSteps.length && cncBox && 'IntersectionObserver' in window && !reduceMotion) {
        // Walk through the three steps only while the section is on screen, until the visitor picks one
        new IntersectionObserver(entries => entries.forEach(e => {
            clearInterval(cncTimer);
            if (e.isIntersecting && !cncUserChose) {
                showCncStep(0);
                cncTimer = setInterval(() => showCncStep((currentCncStep + 1) % cncSteps.length), 2500);
            }
        }), { threshold: 0.5 }).observe(cncBox);
    }

    // --------------------------------------------------------------------------
    // 5. WEEKLY MENU SELECTOR DEMO WIDGET
    // --------------------------------------------------------------------------
    const menuData = {
        mon: {
            es: "<strong>Tradicional:</strong> Pechuga de pollo en crema de chipotle con arroz a la primavera.<br><strong>Saludable:</strong> Bowl de quinoa, verduras asadas y pechuga a la plancha.<br><strong>Postre:</strong> Gelatina de yogur y frutos rojos.",
            en: "<strong>Traditional:</strong> Chicken breast in chipotle cream sauce with primavera rice.<br><strong>Healthy:</strong> Quinoa bowl with roasted vegetables & grilled chicken.<br><strong>Dessert:</strong> Yogurt & red berry parfait."
        },
        tue: {
            es: "<strong>Tradicional:</strong> Carne deshebrada en salsa verde con frijoles refritos y nopales.<br><strong>Saludable:</strong> Filete de pescado al vapor con ensalada cítrica.<br><strong>Postre:</strong> Fruta de temporada en almíbar ligero.",
            en: "<strong>Traditional:</strong> Shredded beef in green salsa with refried beans & cactus.<br><strong>Healthy:</strong> Steamed fish fillet with citrus salad.<br><strong>Dessert:</strong> Seasonal fruit in light syrup."
        },
        wed: {
            es: "<strong>Tradicional:</strong> Lomo de cerdo en adobo artesanal con puré de papa.<br><strong>Saludable:</strong> Ensalada Chef con pechuga de pavo y aderezo bajo en grasa.<br><strong>Postre:</strong> Mousse de limón bajo en azúcar.",
            en: "<strong>Traditional:</strong> Pork loin in artisanal adobo with mashed potatoes.<br><strong>Healthy:</strong> Chef salad with turkey breast & low-fat dressing.<br><strong>Dessert:</strong> Low-sugar lemon mousse."
        },
        thu: {
            es: "<strong>Tradicional:</strong> Fajitas mixtas (res y pollo) con pimientos y tortillas integrales.<br><strong>Saludable:</strong> Wrap vegetariano de hummus y vegetales crujientes.<br><strong>Postre:</strong> Tapioca de coco.",
            en: "<strong>Traditional:</strong> Mixed fajitas (beef & chicken) with peppers & whole wheat tortillas.<br><strong>Healthy:</strong> Vegetarian wrap with hummus & crunchy veggies.<br><strong>Dessert:</strong> Coconut tapioca."
        },
        fri: {
            es: "<strong>Tradicional:</strong> Lasaña bolognesa casera con pan de ajo horneado.<br><strong>Saludable:</strong> Salmón a las finas hierbas con espárragos al vapor.<br><strong>Postre:</strong> Nieve artesanal de frutas.",
            en: "<strong>Traditional:</strong> Homemade beef lasagna with garlic bread.<br><strong>Healthy:</strong> Herb-crusted salmon with steamed asparagus.<br><strong>Dessert:</strong> Artisanal fruit sorbet."
        }
    };

    let currentDay = 'mon';
    const dayBtns = document.querySelectorAll('.day-btn');
    const menuDisplay = document.getElementById('menu-content-display');

    function updateMenuWidget(day) {
        currentDay = day;
        dayBtns.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-day') === day);
        });

        if (menuDisplay && menuData[day]) {
            menuDisplay.innerHTML = menuData[day][currentLang] || menuData[day]['es'];
        }
    }

    dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const day = btn.getAttribute('data-day');
            updateMenuWidget(day);
        });
    });

    // Initialize language (also fills the sample menu) once everything above exists
    setLanguage(currentLang);


    // --------------------------------------------------------------------------
    // 6. BEFORE / AFTER DINING HALL SLIDER
    // --------------------------------------------------------------------------
    const baRange = document.getElementById('ba-range');
    const baBeforeLayer = document.getElementById('ba-before-layer');
    const baHandle = document.getElementById('ba-handle');

    if (baRange && baBeforeLayer && baHandle) {
        baRange.addEventListener('input', (e) => {
            const val = e.target.value;
            baBeforeLayer.style.clipPath = `inset(0 ${100 - val}% 0 0)`;
            baHandle.style.left = `${val}%`;
        });
    }


    // Coverage map: highlight a state from its city chips and vice versa
    const statePaths = document.querySelectorAll('.mexico-map-svg .st.on');
    const cityBtns = document.querySelectorAll('.city-badge[data-state]');
    function hlState(id, on) {
        statePaths.forEach(p => p.classList.toggle('hl', on && p.getAttribute('data-state') === id));
        cityBtns.forEach(b => b.classList.toggle('hl', on && b.getAttribute('data-state') === id));
    }
    cityBtns.forEach(b => {
        const id = b.getAttribute('data-state');
        ['mouseenter', 'focus'].forEach(ev => b.addEventListener(ev, () => hlState(id, true)));
        ['mouseleave', 'blur'].forEach(ev => b.addEventListener(ev, () => hlState(id, false)));
    });
    statePaths.forEach(p => {
        const id = p.getAttribute('data-state');
        p.addEventListener('mouseenter', () => hlState(id, true));
        p.addEventListener('mouseleave', () => hlState(id, false));
    });

    // --------------------------------------------------------------------------
    // 7. MAILTO CONTACT FORM GENERATOR (EXCLUSIVELY FOR SANTIAGO FOX)
    // --------------------------------------------------------------------------
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = document.getElementById('c-name').value.trim();
            const company = document.getElementById('c-company').value.trim();
            const city = document.getElementById('c-city').value.trim();
            const headcount = document.getElementById('c-headcount').value.trim();
            const message = document.getElementById('c-message').value.trim();

            const recipient = "santiago.fox@gpoave.com";
            const subject = encodeURIComponent(`Solicitud de Propuesta Comedor Industrial - ${company}`);
            
            const bodyText = `Hola Santiago Fox,\n\nMe pongo en contacto a través de gpoave.com para solicitar información y una propuesta comercial de servicio de comedor industrial.\n\n` +
                `--- DATOS DE LA PLANTA ---\n` +
                `Nombre del Contacto: ${name}\n` +
                `Empresa / Maquiladora: ${company}\n` +
                `Ciudad de la Planta: ${city}\n` +
                `Comensales Diarios Aprox.: ${headcount}\n\n` +
                `--- MENSAJE Y REQUERIMIENTOS ---\n${message}\n\n` +
                `Quedo en espera de su comunicación. Gracias.`;

            const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(bodyText)}`;

            // Open user's default email program safely
            window.location.href = mailtoUrl;
        });
    }

});