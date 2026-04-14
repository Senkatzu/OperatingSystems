let supabaseClient = null;
let currentUser = null;
let items = [];
let cart = [];
let sales = [];
let salesRange = 'today';
let inventorySearchTerm = '';
let editingItemId = null;

const phpFormatter = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP'
});

function formatCurrency(value) {
    return phpFormatter.format(Number(value) || 0);
}

function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

function getFilteredItems() {
    if (!inventorySearchTerm) return items;
    const term = inventorySearchTerm.toLowerCase();
    return items.filter((item) => String(item.name || '').toLowerCase().includes(term));
}

function getFilteredSales() {
    const now = new Date();
    let from = null;
    if (salesRange === 'today') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (salesRange === 'week') {
        from = new Date(now);
        from.setDate(now.getDate() - 7);
    } else if (salesRange === 'month') {
        from = new Date(now);
        from.setDate(now.getDate() - 30);
    }

    if (!from) return sales;
    return sales.filter((sale) => {
        const created = new Date(sale.created_at);
        return !Number.isNaN(created.getTime()) && created >= from;
    });
}

async function createClient() {
    const config = typeof SUPABASE_CONFIG !== 'undefined'
        ? SUPABASE_CONFIG
        : window.SUPABASE_CONFIG;

    if (!window.supabase || !config) {
        throw new Error('Supabase client/config is missing.');
    }

    supabaseClient = window.supabase.createClient(config.URL, config.ANON_KEY);
}

async function fetchUserByCredentials(username, password) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('id, username, role, password_hash')
        .ilike('username', username)
        .limit(5);

    if (error) throw error;
    if (!data || data.length === 0) return null;

    const normalizedUsername = username.trim().toLowerCase();
    const usernameMatches = data.filter((row) => String(row.username).trim().toLowerCase() === normalizedUsername);

    if (usernameMatches.length > 1) {
        throw new Error('Duplicate usernames found. Please keep usernames unique.');
    }
    if (usernameMatches.length === 0) return null;

    const matched = usernameMatches[0];
    if (String(matched.password_hash).trim() !== String(password).trim()) return null;

    return {
        id: matched.id,
        username: matched.username,
        role: matched.role
    };
}

async function loadItems() {
    const { data, error } = await supabaseClient
        .from('inventory')
        .select('id, name, price, quantity')
        .order('name', { ascending: true });

    if (error) throw error;
    items = data || [];
}

async function loadSales() {
    const { data, error } = await supabaseClient
        .from('sales')
        .select('id, user_id, total, items, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw error;
    sales = data || [];
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminScreen').style.display = 'none';
    document.getElementById('posScreen').style.display = 'none';
    document.getElementById('receiptScreen').style.display = 'none';
}

async function showAdminScreen() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'block';
    document.getElementById('posScreen').style.display = 'none';
    document.getElementById('receiptScreen').style.display = 'none';
    await refreshAdminData();
}

async function showPOSScreen() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'none';
    document.getElementById('posScreen').style.display = 'block';
    document.getElementById('receiptScreen').style.display = 'none';
    await loadItems();
    renderPOSItems();
    updateCart();
}

function showReceiptScreen(receiptData) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'none';
    document.getElementById('posScreen').style.display = 'none';
    document.getElementById('receiptScreen').style.display = 'block';
    renderReceipt(receiptData);
}

async function routeByRole() {
    if (isAdmin()) {
        await showAdminScreen();
        return;
    }
    await showPOSScreen();
}

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');

    try {
        if (!username || !password) {
            errorDiv.textContent = 'Username and password are required.';
            return;
        }

        const user = await fetchUserByCredentials(username, password);
        if (!user) {
            errorDiv.textContent = 'Invalid credentials.';
            return;
        }

        currentUser = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        errorDiv.textContent = '';
        await routeByRole();
    } catch (error) {
        errorDiv.textContent = error.message || 'Login failed.';
    }
}

async function logout() {
    currentUser = null;
    cart = [];
    showLoginScreen();
}

async function refreshAdminData() {
    await Promise.all([loadItems(), loadSales()]);
    renderAdminItems();
    renderSalesReport();
    renderAdminStats();
}

async function addItem() {
    const name = document.getElementById('itemName').value.trim();
    const price = parseFloat(document.getElementById('itemPrice').value);
    const quantity = parseInt(document.getElementById('itemQuantity').value, 10);

    if (!name || Number.isNaN(price) || Number.isNaN(quantity)) {
        alert('Please fill all fields correctly.');
        return;
    }

    const { error } = await supabaseClient
        .from('inventory')
        .insert([{
            id: crypto.randomUUID(),
            name,
            price,
            quantity
        }]);

    if (error) {
        alert(error.message || 'Failed to add item.');
        return;
    }

    document.getElementById('itemName').value = '';
    document.getElementById('itemPrice').value = '';
    document.getElementById('itemQuantity').value = '';

    await refreshAdminData();
}

function renderAdminItems() {
    const grid = document.getElementById('itemsGrid');
    grid.innerHTML = '';
    const filteredItems = getFilteredItems();

    filteredItems.forEach((item) => {
        const itemDiv = document.createElement('div');
        const lowStock = Number(item.quantity) <= 5;
        itemDiv.className = `item-card${lowStock ? ' low-stock' : ''}`;
        itemDiv.innerHTML = `
            <div><strong>${item.name}</strong>${lowStock ? ' <small>(Low stock)</small>' : ''}</div>
            <div>${formatCurrency(item.price)}</div>
            <div>Qty: ${item.quantity}</div>
            <div class="item-actions">
                <button class="edit-btn" data-action="edit" data-id="${item.id}" onclick="editItem('${item.id}')">Edit</button>
                <button class="restock-btn" data-action="restock" data-id="${item.id}" onclick="restockItem('${item.id}', 10)">+10</button>
                <button class="delete-btn" data-action="delete" data-id="${item.id}" onclick="deleteItem('${item.id}')">Delete</button>
            </div>
        `;
        grid.appendChild(itemDiv);
    });

    if (filteredItems.length === 0) {
        grid.innerHTML = '<p>No inventory items matched your search.</p>';
    }
}

async function editItem(id) {
    const item = items.find((i) => String(i.id) === String(id));
    if (!item) {
        alert('Item not found.');
        return;
    }
    openEditModal(item);
}

function openEditModal(item) {
    editingItemId = item.id;
    document.getElementById('editItemName').value = item.name;
    document.getElementById('editItemPrice').value = Number(item.price);
    document.getElementById('editItemQuantity').value = Number(item.quantity);
    document.getElementById('editItemModal').style.display = 'flex';
}

function closeEditModal() {
    editingItemId = null;
    document.getElementById('editItemModal').style.display = 'none';
}

async function saveEditItem() {
    if (!editingItemId) return;

    const newName = document.getElementById('editItemName').value.trim();
    const newPrice = parseFloat(document.getElementById('editItemPrice').value);
    const newQuantity = parseInt(document.getElementById('editItemQuantity').value, 10);

    if (!newName || Number.isNaN(newPrice) || Number.isNaN(newQuantity)) {
        alert('Please provide a valid name, price, and quantity.');
        return;
    }

    const { error } = await supabaseClient
        .from('inventory')
        .update({
            name: newName,
            price: newPrice,
            quantity: newQuantity
        })
        .eq('id', editingItemId);

    if (error) {
        alert(error.message || 'Failed to update item.');
        return;
    }

    closeEditModal();
    await refreshAdminData();
}

async function restockItem(id, amount = 10) {
    const item = items.find((i) => String(i.id) === String(id));
    if (!item) return;

    const { error } = await supabaseClient
        .from('inventory')
        .update({ quantity: Number(item.quantity) + amount })
        .eq('id', id);

    if (error) {
        alert(error.message || 'Failed to restock item.');
        return;
    }

    await refreshAdminData();
}

async function deleteItem(id) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const { error } = await supabaseClient
        .from('inventory')
        .delete()
        .eq('id', id);

    if (error) {
        alert(error.message || 'Failed to delete item.');
        return;
    }

    await refreshAdminData();
}

function renderPOSItems() {
    const grid = document.getElementById('posItemsGrid');
    grid.innerHTML = '';

    items.forEach((item) => {
        if (item.quantity > 0) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'item-btn';
            itemDiv.onclick = () => addToCart(item.id);
            itemDiv.innerHTML = `
                <div class="item-name">${item.name}</div>
                <div class="item-price">${formatCurrency(item.price)}</div>
                <div>Stock: ${item.quantity}</div>
            `;
            grid.appendChild(itemDiv);
        }
    });
}

function addToCart(itemId) {
    const item = items.find((i) => String(i.id) === String(itemId));
    if (!item || item.quantity <= 0) return;

    const cartItem = cart.find((c) => String(c.id) === String(itemId));
    if (cartItem) {
        if (cartItem.quantity < item.quantity) {
            cartItem.quantity += 1;
        } else {
            alert('Not enough stock.');
            return;
        }
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: Number(item.price),
            quantity: 1
        });
    }

    updateCart();
}

function updateCart() {
    const cartDiv = document.getElementById('cartItems');
    const totalDiv = document.getElementById('cartTotal');
    const processBtn = document.getElementById('processBtn');

    cartDiv.innerHTML = '';
    let total = 0;

    cart.forEach((item) => {
        total += item.price * item.quantity;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item';
        itemDiv.innerHTML = `
            <span>${item.name} x${item.quantity}</span>
            <span>${formatCurrency(item.price * item.quantity)}</span>
            <button class="remove-btn" data-action="remove" data-id="${item.id}">Remove</button>
        `;
        cartDiv.appendChild(itemDiv);
    });

    totalDiv.textContent = `Total: ${formatCurrency(total)}`;
    processBtn.disabled = cart.length === 0;
}

function removeFromCart(itemId) {
    cart = cart.filter((item) => String(item.id) !== String(itemId));
    updateCart();
}

async function processSale() {
    if (cart.length === 0) return;

    await loadItems();
    for (const cartItem of cart) {
        const current = items.find((i) => String(i.id) === String(cartItem.id));
        if (!current || current.quantity < cartItem.quantity) {
            alert(`Insufficient stock for ${cartItem.name}.`);
            return;
        }
    }

    for (const cartItem of cart) {
        const current = items.find((i) => String(i.id) === String(cartItem.id));
        const { error } = await supabaseClient
            .from('inventory')
            .update({ quantity: Number(current.quantity) - cartItem.quantity })
            .eq('id', cartItem.id);

        if (error) {
            alert(error.message || 'Failed to update stock.');
            return;
        }
    }

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const receiptItems = cart.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity
    }));

    const { error: saleError } = await supabaseClient
        .from('sales')
        .insert([{
            id: crypto.randomUUID(),
            items: receiptItems,
            total,
            user_id: currentUser.id
        }]);

    if (saleError) {
        alert(saleError.message || 'Failed to record sale.');
        return;
    }

    const receiptData = {
        items: [...cart],
        total,
        date: new Date().toLocaleString()
    };

    cart = [];
    await loadItems();
    showReceiptScreen(receiptData);
}

function renderReceipt(receiptData) {
    const receiptDiv = document.getElementById('receiptContent');
    receiptDiv.innerHTML = `
        <h2>Receipt</h2>
        <p><strong>Date:</strong> ${receiptData.date}</p>
        <hr style="margin: 1rem 0;">
    `;

    receiptData.items.forEach((item) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'receipt-item';
        itemDiv.innerHTML = `
            <span>${item.name} x${item.quantity}</span>
            <span>${formatCurrency(item.price * item.quantity)}</span>
        `;
        receiptDiv.appendChild(itemDiv);
    });

    const totalDiv = document.createElement('div');
    totalDiv.className = 'receipt-item receipt-total';
    totalDiv.innerHTML = `
        <span><strong>Total</strong></span>
        <span><strong>${formatCurrency(receiptData.total)}</strong></span>
    `;
    receiptDiv.appendChild(totalDiv);
}

async function backToPOS() {
    await showPOSScreen();
}

function renderAdminStats() {
    const statsRoot = document.getElementById('adminStats');
    const lowStockCount = items.filter((item) => Number(item.quantity) <= 5).length;
    const inventoryValue = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);

    const today = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter((sale) => String(sale.created_at || '').slice(0, 10) === today);
    const todayRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

    statsRoot.innerHTML = `
        <div class="stat-card"><span class="stat-label">Total SKUs</span><span class="stat-value">${items.length}</span></div>
        <div class="stat-card"><span class="stat-label">Low Stock (<=5)</span><span class="stat-value">${lowStockCount}</span></div>
        <div class="stat-card"><span class="stat-label">Inventory Value</span><span class="stat-value">${formatCurrency(inventoryValue)}</span></div>
        <div class="stat-card"><span class="stat-label">Today's Sales</span><span class="stat-value">${formatCurrency(todayRevenue)}</span></div>
    `;
}

function renderSalesReport() {
    const root = document.getElementById('salesReport');
    const filteredSales = getFilteredSales();

    if (!filteredSales.length) {
        root.innerHTML = '<p style="padding: 0.8rem;">No sales yet.</p>';
        return;
    }

    const rows = filteredSales.slice(0, 50).map((sale) => {
        const dateLabel = new Date(sale.created_at).toLocaleString();
        const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
        const userLabel = sale.user_id ? String(sale.user_id).slice(0, 8) : 'N/A';
        return `
            <tr>
                <td>${dateLabel}</td>
                <td>${userLabel}</td>
                <td>${itemCount}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td><button class="view-items-btn" data-action="view-sale-items" data-sale-id="${sale.id}">View</button></td>
            </tr>
        `;
    }).join('');

    root.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    updateRangeButtons();
}

function renderSaleItems(saleId) {
    const viewer = document.getElementById('saleDetailBody');
    const sale = sales.find((entry) => String(entry.id) === String(saleId));
    if (!sale) {
        viewer.innerHTML = '<p>Select a sale to view sold items.</p>';
        return;
    }

    const soldItems = Array.isArray(sale.items) ? sale.items : [];
    if (soldItems.length === 0) {
        viewer.innerHTML = '<p>No item details stored for this sale.</p>';
        return;
    }

    const rows = soldItems.map((item) => {
        const name = item.name || 'Unnamed';
        const qty = Number(item.quantity) || 0;
        const lineTotal = (Number(item.price) || 0) * qty;
        return `<li><span>${name} x${qty}</span><strong>${formatCurrency(lineTotal)}</strong></li>`;
    }).join('');

    viewer.innerHTML = `
        <h4>Items Sold - ${new Date(sale.created_at).toLocaleString()}</h4>
        <ul>${rows}</ul>
        <p style="margin-top: 0.45rem;"><strong>Sale Total:</strong> ${formatCurrency(sale.total)}</p>
    `;

    document.getElementById('saleDetailModal').style.display = 'flex';
}

function closeSaleDetailModal() {
    document.getElementById('saleDetailModal').style.display = 'none';
}

function bindUiEvents() {
    document.getElementById('itemsGrid').addEventListener('click', async (event) => {
        const element = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
        if (!element) return;
        const action = element.dataset.action;
        const id = element.dataset.id;
        if (!action || !id) return;

        if (action === 'edit') await editItem(id);
        if (action === 'delete') await deleteItem(id);
        if (action === 'restock') await restockItem(id, 10);
    });

    document.getElementById('cartItems').addEventListener('click', (event) => {
        const element = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
        if (!element) return;
        if (element.dataset.action === 'remove' && element.dataset.id) {
            removeFromCart(element.dataset.id);
        }
    });

    document.getElementById('salesReport').addEventListener('click', (event) => {
        const element = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
        if (!element) return;
        if (element.dataset.action === 'view-sale-items' && element.dataset.saleId) {
            renderSaleItems(element.dataset.saleId);
        }
    });

    document.getElementById('inventorySearch').addEventListener('input', (event) => {
        const target = event.target;
        inventorySearchTerm = target instanceof HTMLInputElement ? target.value.trim() : '';
        renderAdminItems();
    });
}

function updateRangeButtons() {
    const rangeButtons = document.querySelectorAll('.range-group .secondary-btn[data-range]');
    rangeButtons.forEach((button) => {
        const isActive = button.dataset.range === salesRange;
        button.classList.toggle('active', isActive);
    });
}

function setSalesRange(range) {
    salesRange = range;
    renderSalesReport();
}

function toCsvCell(value) {
    const raw = String(value ?? '');
    return `"${raw.replace(/"/g, '""')}"`;
}

function exportSalesCsv() {
    const filteredSales = getFilteredSales();
    if (!filteredSales.length) {
        alert('No sales to export for selected range.');
        return;
    }

    const header = ['sale_id', 'created_at', 'user_id', 'item_count', 'total_php', 'items_json'];
    const lines = [header.join(',')];

    filteredSales.forEach((sale) => {
        const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
        const row = [
            toCsvCell(sale.id),
            toCsvCell(sale.created_at),
            toCsvCell(sale.user_id),
            toCsvCell(itemCount),
            toCsvCell(Number(sale.total || 0).toFixed(2)),
            toCsvCell(JSON.stringify(sale.items || []))
        ];
        lines.push(row.join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const datePart = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `sales-report-${salesRange}-${datePart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

async function initializeApp() {
    try {
        await createClient();
        bindUiEvents();
        showLoginScreen();
    } catch (error) {
        document.getElementById('loginError').textContent = error.message || 'Failed to initialize app.';
        showLoginScreen();
    }
}

window.login = login;
window.logout = logout;
window.addItem = addItem;
window.processSale = processSale;
window.backToPOS = backToPOS;
window.refreshAdminData = refreshAdminData;
window.editItem = editItem;
window.restockItem = restockItem;
window.deleteItem = deleteItem;
window.setSalesRange = setSalesRange;
window.exportSalesCsv = exportSalesCsv;
window.saveEditItem = saveEditItem;
window.closeEditModal = closeEditModal;
window.closeSaleDetailModal = closeSaleDetailModal;

initializeApp();
