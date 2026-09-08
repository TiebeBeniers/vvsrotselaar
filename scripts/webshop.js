// ===============================================
// WEBSHOP.JS – Clubshop (kledij bestellen & afhalen)
// V.V.S Rotselaar
//
// Firestore-structuur:
//   settings/webshop        → { active: bool, intro: string, pickupInfo: string,
//                                updatedAt }
//   shop_items/{id}         → { name, description, price (number, euro),
//                                images: [{ url, path }] (ordered, eerste = hoofdfoto),
//                                category, sizes: string[],
//                                active: bool, order: number, createdAt }
//                              (oudere producten kunnen nog een los `image`/`imagePath`
//                               veld hebben — wordt hieronder als fallback gelezen)
//   shop_orders/{id}        → { userId, userName, userEmail,
//                                items: [{ itemId, name, price, size, qty }],
//                                total, status: 'nieuw', createdAt }
//
// Dit bestand bouwt de volledige klantflow (bekijken → productdetail met
// foto-gallerij → winkelmandje → bestelling plaatsen). Een product is
// deelbaar via een link met querystring, bv. webshop.html?item=<documentId>,
// die automatisch de detailpopup van dat product opent.
// Betaalintegratie is bewust nog niet aangesloten — zie de TODO bij
// placeOrder().
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    doc, getDoc, collection, onSnapshot, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── State ────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let shopSettings    = { active: false, intro: '', pickupInfo: '' };
let productsData    = {};   // id → product doc
let unsubProducts   = null;
let cart             = [];  // [{ itemId, name, price, size, qty }]
let toastTimer;
let _deepLinkHandled = false;

const CART_STORAGE_KEY = 'vvs_webshop_cart';

// ── Scroll lock helper (gedeeld tussen cart-drawer en productmodal) ───────────
const _scrollLocks = new Set();
function lockScroll(reason) {
    _scrollLocks.add(reason);
    document.body.style.overflow = 'hidden';
}
function unlockScroll(reason) {
    _scrollLocks.delete(reason);
    if (_scrollLocks.size === 0) document.body.style.overflow = '';
}

// ── Auth guard (zelfde patroon als werklijst.js) ──────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('authGuard').style.display      = 'flex';
        document.getElementById('loginLink').textContent        = 'LOGIN';
        return;
    }

    currentUser = user;

    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            document.getElementById('loginLink').textContent = 'PROFIEL';
        }
    } catch (e) {
        console.error('User load error:', e);
    }

    // Toegangscheck — zelfde logica als werklijst: iedereen die ingelogd is
    // heeft toegang, behalve externe accounts, die expliciet het
    // 'winkel'-recht nodig hebben.
    const permissions = currentUserData?.permissions || [];
    const isExtern         = permissions.includes('extern');
    const heeftWinkelRecht = permissions.includes('winkel');
    const heeftToegang     = isExtern ? heeftWinkelRecht : true;

    if (!heeftToegang) {
        document.getElementById('loadingSpinner').style.display = 'none';
        const guard = document.getElementById('authGuard');
        if (guard) {
            guard.innerHTML = `
                <div class="auth-guard-inner">
                    <div class="state-icon">&#128274;</div>
                    <h2>Geen toegang</h2>
                    <p>Je hebt geen toegang tot de webshop. Neem contact op met de beheerder.</p>
                    <a href="index.html" class="state-action-btn">Terug naar home</a>
                </div>`;
            guard.style.display = 'flex';
        }
        return;
    }

    loadCartFromStorage();
    await loadShopSettings();
});

// ── Instellingen laden ────────────────────────────────────────────────────────
async function loadShopSettings() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'webshop'));
        if (snap.exists()) {
            shopSettings = { active: false, intro: '', pickupInfo: '', ...snap.data() };
        }
    } catch (e) {
        console.error('loadShopSettings error:', e);
    }

    document.getElementById('loadingSpinner').style.display = 'none';
    document.getElementById('mainContent').style.display    = 'block';

    if (!shopSettings.active) {
        document.getElementById('shopClosedNotice').style.display = 'flex';
        return;
    }

    // Intro & afhaalinfo tonen indien ingevuld
    const introEl = document.getElementById('shopIntroText');
    if (shopSettings.intro?.trim()) {
        introEl.textContent   = shopSettings.intro;
        introEl.style.display = 'block';
    }

    const pickupBanner = document.getElementById('shopPickupBanner');
    const pickupText   = document.getElementById('shopPickupText');
    if (shopSettings.pickupInfo?.trim()) {
        pickupText.textContent      = shopSettings.pickupInfo;
        pickupBanner.style.display  = 'flex';
    }

    document.getElementById('cartFab').style.display = 'flex';
    listenToProducts();
}

// ── Producten laden (live) ────────────────────────────────────────────────────
function listenToProducts() {
    if (unsubProducts) unsubProducts();

    unsubProducts = onSnapshot(
        collection(db, 'shop_items'),
        (snapshot) => {
            productsData = {};
            snapshot.forEach(d => { productsData[d.id] = { id: d.id, ...d.data() }; });
            renderProducts();
        },
        (err) => {
            console.error('Products listener error:', err);
            showToast('Fout bij laden van producten: ' + err.message, 'error');
        }
    );
}

// ── Afbeeldingen ophalen (met fallback voor oude single-image producten) ─────
function getProductImages(p) {
    if (Array.isArray(p.images) && p.images.length) {
        return p.images.map(im => (typeof im === 'string' ? im : im.url)).filter(Boolean);
    }
    if (p.image) return [p.image];
    return [];
}

// ── Producten renderen ────────────────────────────────────────────────────────
function renderProducts() {
    const grid        = document.getElementById('shopGrid');
    const emptyNotice = document.getElementById('emptyShopNotice');

    const products = Object.values(productsData)
        .filter(p => p.active)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (products.length === 0) {
        grid.innerHTML = '';
        emptyNotice.style.display = 'flex';
    } else {
        emptyNotice.style.display = 'none';

        grid.innerHTML = products.map(p => {
            const images = getProductImages(p);
            const cover = images[0];
            const imageStyle = cover ? `style="background-image:url('${escAttr(cover)}')"` : '';

            return `
                <div class="shop-card" data-id="${p.id}">
                    <div class="shop-card-image" ${imageStyle}>
                        ${cover ? '' : '📦'}
                        ${p.category ? `<span class="shop-card-category">${escHtml(p.category)}</span>` : ''}
                        ${images.length > 1 ? `<span class="shop-card-image-count">🖼️ ${images.length}</span>` : ''}
                    </div>
                    <div class="shop-card-body">
                        <h3>${escHtml(p.name || 'Product')}</h3>
                        <div class="shop-card-price">€${formatPrice(p.price)}</div>
                        <div class="shop-card-cta">Bekijk product →</div>
                    </div>
                </div>`;
        }).join('');

        grid.querySelectorAll('.shop-card').forEach(card => {
            card.addEventListener('click', () => openProductModal(card.dataset.id));
        });
    }

    // Deeplink: enkel bij de allereerste render proberen te openen
    if (!_deepLinkHandled) {
        _deepLinkHandled = true;
        const requestedId = new URLSearchParams(window.location.search).get('item');
        if (requestedId) openProductModal(requestedId, { fromDeepLink: true });
    }
}

// ── Winkelmandje ───────────────────────────────────────────────────────────────
function loadCartFromStorage() {
    try {
        const raw = sessionStorage.getItem(CART_STORAGE_KEY);
        cart = raw ? JSON.parse(raw) : [];
    } catch (_) { cart = []; }
    updateCartUI();
}

function saveCartToStorage() {
    try { sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (_) {}
}

function addToCart(product, size, qty) {
    if (!product) return;
    const existing = cart.find(c => c.itemId === product.id && c.size === size);
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({ itemId: product.id, name: product.name, price: product.price, size: size || null, qty });
    }
    saveCartToStorage();
    updateCartUI();
    showToast(`${product.name} toegevoegd aan je winkelmandje`, 'success');
}

function removeFromCart(index) {
    cart.splice(index, 1);
    saveCartToStorage();
    updateCartUI();
}

function setCartQty(index, newQty) {
    if (!cart[index]) return;
    if (newQty < 1) {
        removeFromCart(index);
        return;
    }
    cart[index].qty = Math.min(20, newQty);
    saveCartToStorage();
    updateCartUI();
}

function cartTotal() {
    return cart.reduce((sum, c) => sum + (c.price * c.qty), 0);
}

function updateCartUI() {
    const badge  = document.getElementById('cartFabBadge');
    const count  = cart.reduce((sum, c) => sum + c.qty, 0);
    badge.textContent   = count;
    badge.style.display = count > 0 ? 'flex' : 'none';

    const list = document.getElementById('cartItemsList');
    if (cart.length === 0) {
        list.innerHTML = '<div class="cart-empty">Je winkelmandje is leeg.</div>';
    } else {
        list.innerHTML = cart.map((c, i) => `
            <div class="cart-item">
                <div class="cart-item-info">
                    <strong>${escHtml(c.name)}</strong>
                    ${c.size ? `<span class="cart-item-size">Maat ${escHtml(c.size)}</span>` : ''}
                    <div class="cart-item-qty">
                        <button class="cart-qty-btn" data-action="dec" data-index="${i}" aria-label="Minder">&minus;</button>
                        <span class="cart-qty-value">${c.qty}</span>
                        <button class="cart-qty-btn" data-action="inc" data-index="${i}" aria-label="Meer" ${c.qty >= 20 ? 'disabled' : ''}>+</button>
                    </div>
                    <button class="cart-item-remove" data-index="${i}">Verwijderen</button>
                </div>
                <div class="cart-item-price">€${formatPrice(c.price * c.qty)}</div>
            </div>`).join('');

        list.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.index, 10)));
        });
        list.querySelectorAll('.cart-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                const delta = btn.dataset.action === 'inc' ? 1 : -1;
                setCartQty(idx, cart[idx].qty + delta);
            });
        });
    }

    document.getElementById('cartTotal').textContent = `€${formatPrice(cartTotal())}`;
    document.getElementById('cartCheckoutBtn').disabled = cart.length === 0;
}

// ── Drawer open/dicht ──────────────────────────────────────────────────────────
const cartFab      = document.getElementById('cartFab');
const cartDrawer    = document.getElementById('cartDrawer');
const cartBackdrop  = document.getElementById('cartBackdrop');
const cartCloseBtn  = document.getElementById('cartCloseBtn');

function openCart()  {
    cartDrawer.classList.add('active');
    cartBackdrop.classList.add('active');
    lockScroll('cart');
}
function closeCart() {
    cartDrawer.classList.remove('active');
    cartBackdrop.classList.remove('active');
    unlockScroll('cart');
}

cartFab?.addEventListener('click', openCart);
cartCloseBtn?.addEventListener('click', closeCart);
cartBackdrop?.addEventListener('click', closeCart);

// ── Productdetail modal (gallerij + opties) ───────────────────────────────────
const productModal      = document.getElementById('productModal');
const productModalClose = document.getElementById('productModalClose');
const galleryMainImage  = document.getElementById('galleryMainImage');
const galleryMainImg    = document.getElementById('galleryMainImg');
const galleryPrevBtn    = document.getElementById('galleryPrevBtn');
const galleryNextBtn    = document.getElementById('galleryNextBtn');
const galleryDots       = document.getElementById('galleryDots');
const galleryThumbs     = document.getElementById('galleryThumbs');
const galleryNoImageIcon = document.getElementById('galleryNoImageIcon');
const modalCategory     = document.getElementById('modalCategory');
const modalName         = document.getElementById('modalName');
const modalPrice        = document.getElementById('modalPrice');
const modalDesc         = document.getElementById('modalDesc');
const modalSizeGroup    = document.getElementById('modalSizeGroup');
const modalSizePills    = document.getElementById('modalSizePills');
const modalSizeHint     = document.getElementById('modalSizeHint');
const modalQtyValue     = document.getElementById('modalQtyValue');
const modalQtyDec       = document.getElementById('modalQtyDec');
const modalQtyInc       = document.getElementById('modalQtyInc');
const modalAddBtn       = document.getElementById('modalAddBtn');
const modalShareBtn     = document.getElementById('modalShareBtn');

let modalProduct  = null;
let modalImages   = [];
let modalIndex    = 0;
let modalSize     = null;
let modalQty      = 1;

function openProductModal(id, opts = {}) {
    const product = productsData[id];

    if (!product || !product.active) {
        // Niet (meer) beschikbaar — bv. via een oude/verlopen deel-link
        if (opts.fromDeepLink) {
            showToast('Dit product is niet (meer) beschikbaar.', 'error');
            history.replaceState(null, '', window.location.pathname);
        }
        return;
    }

    modalProduct = product;
    modalImages  = getProductImages(product);
    modalIndex   = 0;
    modalQty     = 1;
    modalSize    = null;

    // Info invullen
    if (product.category) {
        modalCategory.textContent   = product.category;
        modalCategory.style.display = 'block';
    } else {
        modalCategory.style.display = 'none';
    }
    modalName.textContent  = product.name || 'Product';
    modalPrice.textContent = `€${formatPrice(product.price)}`;
    modalDesc.textContent  = product.description || '';

    // Maten
    const sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : [];
    if (sizes.length) {
        modalSizeGroup.style.display = 'block';
        modalSizeHint.classList.remove('show');
        modalSizePills.innerHTML = sizes.map(s =>
            `<button type="button" class="size-pill" data-size="${escAttr(s)}">${escHtml(s)}</button>`).join('');
        modalSizePills.querySelectorAll('.size-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                modalSize = pill.dataset.size;
                modalSizePills.querySelectorAll('.size-pill').forEach(p => p.classList.toggle('selected', p === pill));
                modalSizeHint.classList.remove('show');
            });
        });
    } else {
        modalSizeGroup.style.display = 'none';
    }

    updateModalQtyDisplay();
    renderGallery();

    productModal.classList.add('active');
    lockScroll('productModal');

    // URL bijwerken zodat het product deelbaar is (zonder extra history-entry)
    const url = new URL(window.location.href);
    url.searchParams.set('item', id);
    history.replaceState(null, '', url);
}

function closeProductModal() {
    productModal.classList.remove('active');
    unlockScroll('productModal');
    modalProduct = null;

    const url = new URL(window.location.href);
    url.searchParams.delete('item');
    history.replaceState(null, '', url.pathname + (url.search || ''));
}

function renderGallery() {
    if (modalImages.length === 0) {
        galleryMainImg.style.display = 'none';
        galleryNoImageIcon.style.display = 'flex';
        galleryDots.innerHTML   = '';
        galleryThumbs.innerHTML = '';
        galleryPrevBtn.style.display = 'none';
        galleryNextBtn.style.display = 'none';
        return;
    }

    galleryNoImageIcon.style.display = 'none';
    showGalleryImage(0);

    const multi = modalImages.length > 1;
    galleryPrevBtn.style.display = multi ? 'flex' : 'none';
    galleryNextBtn.style.display = multi ? 'flex' : 'none';

    galleryDots.innerHTML = multi
        ? modalImages.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}" data-index="${i}"></span>`).join('')
        : '';

    galleryThumbs.innerHTML = multi
        ? modalImages.map((url, i) =>
            `<div class="gallery-thumb${i === 0 ? ' active' : ''}" data-index="${i}" style="background-image:url('${escAttr(url)}')"></div>`).join('')
        : '';

    galleryThumbs.querySelectorAll('.gallery-thumb').forEach(t => {
        t.addEventListener('click', () => showGalleryImage(parseInt(t.dataset.index, 10)));
    });
    galleryDots.querySelectorAll('.dot').forEach(d => {
        d.addEventListener('click', () => showGalleryImage(parseInt(d.dataset.index, 10)));
    });
}

function showGalleryImage(index) {
    if (modalImages.length === 0) return;
    modalIndex = (index + modalImages.length) % modalImages.length;

    galleryMainImg.src = modalImages[modalIndex];
    galleryMainImg.alt = modalProduct?.name || '';
    galleryMainImg.style.display = 'block';

    galleryThumbs.querySelectorAll('.gallery-thumb').forEach((t, i) =>
        t.classList.toggle('active', i === modalIndex));
    galleryDots.querySelectorAll('.dot').forEach((d, i) =>
        d.classList.toggle('active', i === modalIndex));
}

galleryPrevBtn?.addEventListener('click', () => showGalleryImage(modalIndex - 1));
galleryNextBtn?.addEventListener('click', () => showGalleryImage(modalIndex + 1));

// Swipe-ondersteuning op mobiel
let _touchStartX = null;
galleryMainImage?.addEventListener('touchstart', (e) => { _touchStartX = e.touches[0].clientX; }, { passive: true });
galleryMainImage?.addEventListener('touchend', (e) => {
    if (_touchStartX === null) return;
    const deltaX = e.changedTouches[0].clientX - _touchStartX;
    if (Math.abs(deltaX) > 40) showGalleryImage(modalIndex + (deltaX < 0 ? 1 : -1));
    _touchStartX = null;
}, { passive: true });

// Toetsenbord: pijltjes navigeren, Escape sluit
document.addEventListener('keydown', (e) => {
    if (!productModal.classList.contains('active')) return;
    if (e.key === 'ArrowLeft')  showGalleryImage(modalIndex - 1);
    if (e.key === 'ArrowRight') showGalleryImage(modalIndex + 1);
    if (e.key === 'Escape')     closeProductModal();
});

function updateModalQtyDisplay() {
    modalQtyValue.textContent = modalQty;
    modalQtyDec.disabled = modalQty <= 1;
    modalQtyInc.disabled = modalQty >= 20;
}

modalQtyDec?.addEventListener('click', () => { if (modalQty > 1) { modalQty--; updateModalQtyDisplay(); } });
modalQtyInc?.addEventListener('click', () => { if (modalQty < 20) { modalQty++; updateModalQtyDisplay(); } });

modalAddBtn?.addEventListener('click', () => {
    if (!modalProduct) return;
    const sizes = Array.isArray(modalProduct.sizes) ? modalProduct.sizes.filter(Boolean) : [];
    if (sizes.length && !modalSize) {
        modalSizeHint.classList.add('show');
        return;
    }
    addToCart(modalProduct, modalSize, modalQty);
});

modalShareBtn?.addEventListener('click', async () => {
    if (!modalProduct) return;
    const url = new URL(window.location.href);
    url.searchParams.set('item', modalProduct.id);
    const shareUrl = url.toString();
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link naar dit product gekopieerd', 'success');
    } catch (_) {
        window.prompt('Kopieer deze link:', shareUrl);
    }
});

productModalClose?.addEventListener('click', closeProductModal);
productModal?.addEventListener('click', (e) => {
    if (e.target === productModal) closeProductModal();
});

// ── Bestelling plaatsen ────────────────────────────────────────────────────────
document.getElementById('cartCheckoutBtn')?.addEventListener('click', placeOrder);

async function placeOrder() {
    if (cart.length === 0 || !currentUser) return;

    const btn = document.getElementById('cartCheckoutBtn');
    btn.disabled = true;
    btn.textContent = 'Bezig…';

    try {
        // TODO: hier komt later de online betaling (bv. Mollie/Stripe) vóór het
        // wegschrijven van de bestelling. Voorlopig wordt de bestelling meteen
        // geregistreerd met status 'nieuw' zodat de admin ze manueel kan opvolgen.
        await addDoc(collection(db, 'shop_orders'), {
            userId: currentUser.uid,
            userName: currentUserData?.name || currentUser.displayName || '',
            userEmail: currentUserData?.email || currentUser.email || '',
            items: cart.map(c => ({ itemId: c.itemId, name: c.name, price: c.price, size: c.size, qty: c.qty })),
            total: cartTotal(),
            status: 'nieuw',
            createdAt: serverTimestamp()
        });

        cart = [];
        saveCartToStorage();
        updateCartUI();
        closeCart();

        const confirmText = document.getElementById('orderConfirmText');
        confirmText.textContent = shopSettings.pickupInfo?.trim()
            ? `Je bestelling is geplaatst. ${shopSettings.pickupInfo}`
            : 'Je bestelling is geplaatst. Je ontvangt binnenkort meer info over afhalen en betalen.';
        document.getElementById('orderConfirmModal').classList.add('active');

    } catch (e) {
        console.error('placeOrder error:', e);
        showToast('Fout bij plaatsen van bestelling: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Bestelling plaatsen';
    }
}

document.getElementById('orderConfirmCloseBtn')?.addEventListener('click', () => {
    document.getElementById('orderConfirmModal').classList.remove('active');
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatPrice(value) {
    const n = Number(value) || 0;
    return n.toFixed(2).replace('.', ',');
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
    return String(str ?? '').replace(/'/g, '%27').replace(/"/g, '%22');
}

function showToast(msg, type = '') {
    const t = document.getElementById('shopToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'shop-toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3500);
}