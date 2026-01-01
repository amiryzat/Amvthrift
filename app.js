// ==========================================
// ⚠️ YOUR SUPABASE KEYS ⚠️
// ==========================================
const SUPABASE_URL = "https://vgfvxwfltpnakfnfcrog.supabase.co";
const SUPABASE_KEY = "sb_publishable_9OfrTSQEnWdRnZMsTrnzgg__2jWuYbK";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Variables
let debounceTimer;
let currentSort = { field: 'created_at', direction: 'desc' }; 
let itemToDeleteId = null;
let itemToRemoveId = null; 
let saleToDeleteId = null;
let currentSalesDropId = null; 
let selectedInventoryIds = new Set(); 
let cachedInventoryData = []; 
let activeSelectTab = 'Cloth'; 
let salesData = [];
let salesPage = 1;
const salesPerPage = 10;
let currentDropItemIds = new Set();
let salesDataLoaded = false; 

// --- INITIALIZE ---
window.onload = function() {
    fetchItems();
    fetchInventoryTotal(); 
    
    // NEW: Init Time Dropdown options
    initTimeDropdown();
    
    // NEW: Add listeners to custom time inputs
    document.getElementById('time-hh').addEventListener('input', syncTimeInput);
    document.getElementById('time-mm').addEventListener('input', syncTimeInput);

    setupSearch('search-box', 'clear-inv-search', () => fetchItems(document.getElementById('search-box').value));
    setupSearch('sales-search-box', 'clear-sales-search', () => fetchSales(document.getElementById('sales-search-box').value));
    setupSearch('overview-search-box', 'clear-ov-search', () => fetchSalesItems(currentSalesDropId, document.getElementById('overview-search-box').value));
    
    const invSearchInput = document.getElementById('select-inv-search');
    if(invSearchInput) {
        invSearchInput.addEventListener('input', () => { renderInventorySelection(); });
    }

    setupEnterSubmit('add-modal', addItem);
    setupEnterSubmit('edit-modal', saveEditItem);
    setupEnterSubmit('sales-modal', saveSalesDrop);
    
    triggerAnimation('inventory-page');
    updateSortMenuUI(); 
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sort-container')) {
            document.getElementById('sort-menu').classList.remove('show');
        }
        // Close Time Dropdown if clicked outside
        if (!e.target.closest('.time-picker-group') && !e.target.closest('.time-dropdown-list')) {
            document.getElementById('time-presets').classList.remove('show');
        }
    });
};

// =======================================================
// NEW: CUSTOM TIME PICKER LOGIC
// =======================================================

function initTimeDropdown() {
    const list = document.getElementById('time-presets');
    list.innerHTML = "";
    
    // Generate times every 30 mins
    for(let i=0; i<24; i++) {
        for(let j=0; j<60; j+=30) {
            const h = i; 
            const m = j === 0 ? "00" : "30";
            
            // Format 12h for display
            let displayH = h % 12 || 12;
            let ampm = h < 12 ? "AM" : "PM";
            let displayTime = `${displayH}:${m} ${ampm}`;
            
            // Value for parsing
            let rawH = i;
            let rawM = j;
            
            const div = document.createElement('div');
            div.className = 'time-option';
            div.innerText = displayTime;
            div.onclick = () => selectTimeOption(rawH, rawM);
            list.appendChild(div);
        }
    }
}

function toggleTimeDropdown() {
    document.getElementById('time-presets').classList.toggle('show');
}

function selectTimeOption(h, m) {
    // Convert 24h to 12h for UI
    let ampm = h >= 12 ? "PM" : "AM";
    let displayH = h % 12 || 12;
    let displayM = m < 10 ? "0" + m : m;

    document.getElementById('time-hh').value = displayH;
    document.getElementById('time-mm').value = displayM;
    document.getElementById('time-ampm').innerText = ampm;
    
    syncTimeInput(); // Update hidden field
    document.getElementById('time-presets').classList.remove('show');
}

function toggleAmPm() {
    const btn = document.getElementById('time-ampm');
    btn.innerText = btn.innerText === "AM" ? "PM" : "AM";
    syncTimeInput();
}

function syncTimeInput() {
    // Reads 3 visible fields -> Updates 1 hidden field (24h format)
    let h = parseInt(document.getElementById('time-hh').value) || 0;
    let m = parseInt(document.getElementById('time-mm').value) || 0;
    let ampm = document.getElementById('time-ampm').innerText;

    if (h === 12) h = 0; 
    if (ampm === "PM") h += 12;

    let hStr = h < 10 ? "0" + h : h;
    let mStr = m < 10 ? "0" + m : m;

    document.getElementById('sales-time').value = `${hStr}:${mStr}`;
}

function setTimePickerFromValue(timeStr) {
    // timeStr is "HH:mm:ss" or "HH:mm" (24h)
    if (!timeStr) {
        // Default to now
        const now = new Date();
        selectTimeOption(now.getHours(), now.getMinutes());
        return;
    }

    let [h, m] = timeStr.split(':').map(Number);
    selectTimeOption(h, m);
}

// =======================================================
// SEARCH HELPER
// =======================================================
function setupSearch(inputId, clearBtnId, func) {
    const input = document.getElementById(inputId); 
    const clearBtn = document.getElementById(clearBtnId);
    if(!input || !clearBtn) return;
    
    input.addEventListener('input', (e) => { 
        clearBtn.style.display = input.value.trim().length > 0 ? 'block' : 'none';
        clearTimeout(debounceTimer); 
        debounceTimer = setTimeout(func, 300); 
    }); 
}

function clearSearch(inputId, clearBtnId) {
    const input = document.getElementById(inputId);
    const clearBtn = document.getElementById(clearBtnId);
    if(input) {
        input.value = "";
        clearBtn.style.display = 'none';
        
        if(inputId === 'search-box') fetchItems();
        else if(inputId === 'sales-search-box') fetchSales();
        else if(inputId === 'overview-search-box') fetchSalesItems(currentSalesDropId);
    }
}

// =======================================================
// PART 1: INVENTORY LOGIC
// =======================================================
async function fetchItems(searchQuery = "") {
    let query = db.from('items').select('*');
    if (searchQuery.trim() !== "") {
        query = query.or(`name.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%`);
    }
    const { data, error } = await query;
    if (error) { console.error(error); return; }
    
    if (data) {
        data.sort((a, b) => {
            let valA, valB;
            if (currentSort.field === 'name') {
                valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
                return currentSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (currentSort.field === 'price') {
                valA = parseFloat(a.sell_price) || 0; valB = parseFloat(b.sell_price) || 0;
                return currentSort.direction === 'asc' ? valA - valB : valB - valA;
            } else {
                valA = new Date(a.created_at); valB = new Date(b.created_at);
                return currentSort.direction === 'asc' ? valA - valB : valB - valA;
            }
        });
    }

    const clothItems = []; const pantItems = []; const accItems = []; const soldItems = [];
    if (data) {
        data.forEach(item => {
            if (item.status === 'sold') soldItems.push(item);
            else {
                if (item.category === 'Cloth') clothItems.push(item);
                else if (item.category === 'Pant') pantItems.push(item);
                else if (item.category === 'Accessories') accItems.push(item);
            }
        });
    }

    const totalCount = clothItems.length + pantItems.length + accItems.length + soldItems.length;
    const emptyState = document.getElementById('inv-empty-state');
    const totalCounter = document.getElementById('inventory-total-container');
    
    if (searchQuery.trim() !== "") {
        if (totalCounter) totalCounter.style.display = 'none';
        if (totalCount === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
        }
    } else {
        if (totalCounter) totalCounter.style.display = 'flex';
        emptyState.style.display = 'none';
    }

    renderTableSection('list-cloth', 'count-cloth', clothItems, false, searchQuery);
    renderTableSection('list-pant', 'count-pant', pantItems, false, searchQuery);
    renderTableSection('list-accessories', 'count-accessories', accItems, false, searchQuery);
    renderTableSection('list-sold', 'count-sold', soldItems, true, searchQuery);
}

// Function to fetch GRAND total (update value span only)
async function fetchInventoryTotal() {
    const { count, error } = await db.from('items')
        .select('*', { count: 'exact', head: true }) 
        .eq('status', 'available');
        
    if (!error) {
        const counterEl = document.getElementById('inventory-total-count');
        if (counterEl) counterEl.innerText = count || 0;
    }
}

function renderTableSection(tableBodyId, countId, items, isSoldTable = false, searchQuery = "") {
    const list = document.getElementById(tableBodyId);
    const countLabel = document.getElementById(countId);
    if (!list || !countLabel) return;

    countLabel.innerText = items.length;
    list.innerHTML = "";
    const section = list.closest('.category-section');
    
    if (currentSalesDropId !== null) {
        if (items.length === 0) {
            section.style.display = 'none';
            return; 
        } else {
            section.style.display = 'block';
        }
    } else {
        if (searchQuery.trim() !== "" && items.length === 0) {
            section.style.display = 'none';
            return; 
        } else {
            section.style.display = 'block';
        }
    }

    if (items.length === 0) {
        const cols = isSoldTable ? 9 : 8;
        list.innerHTML = `<tr><td colspan='${cols}' style="text-align:center; color:#666; padding:20px;">No items available</td></tr>`;
        return;
    }

    let sumCost = 0, sumSell = 0, sumProfit = 0, sumLoss = 0;
    let lastRowDelay = 0;

    items.forEach((item, index) => {
        const statusClass = item.status === 'sold' ? 'sold' : 'available';
        const cost = parseFloat(item.cost_price) || 0;
        const sell = parseFloat(item.sell_price) || 0;
        const diff = sell - cost;
        sumCost += cost; sumSell += sell;
        if (diff >= 0) sumProfit += diff; else sumLoss += Math.abs(diff);

        let profitDisplay = diff >= 0 ? `<span class="profit-text">RM ${diff}</span>` : "-";
        let lossDisplay = diff < 0 ? `<span class="loss-text">RM ${Math.abs(diff)}</span>` : "-";
        
        let deleteAction = "";
        if (currentSalesDropId) {
            deleteAction = `<button class="remove-btn" onclick="openRemoveModal('${item.id}')">Remove</button>`;
        } else {
            deleteAction = `<button class="delete-btn" onclick="openDeleteModal('${item.id}')">Delete</button>`;
        }

        let delay = index * 0.05; if (delay > 1.0) delay = 1.0; lastRowDelay = delay;

        let row = `<tr class="table-row-animate" style="animation-delay: ${delay}s">
            <td class="row-number">${index + 1}</td>
            <td>${item.name}</td>
            ${isSoldTable ? `<td style="color:#888; font-size:12px">${item.category}</td>` : ''}
            <td>RM ${cost}</td>
            <td>RM ${sell}</td>
            <td>${profitDisplay}</td>
            <td>${lossDisplay}</td>
            <td>
                <select class="status-select ${statusClass}" onchange="updateStatus('${item.id}', this)">
                    <option value="available" ${item.status === 'available' ? 'selected' : ''}>Available</option>
                    <option value="sold" ${item.status === 'sold' ? 'selected' : ''}>Sold</option>
                </select>
            </td>
            <td>
                <div class="action-cell">
                    <button class="edit-btn" onclick="openEditModal('${item.id}', '${item.name}', '${item.category}', '${cost}', '${sell}')">Edit</button>
                    ${deleteAction}
                </div>
            </td>
        </tr>`;
        list.innerHTML += row;
    });

    const costTotal = sumCost > 0 ? `RM ${sumCost}` : '-';
    const sellTotal = sumSell > 0 ? `RM ${sumSell}` : '-'; 
    const profitTotal = sumProfit > 0 ? `<span class="profit-text">RM ${sumProfit}</span>` : '-';
    const lossTotal = sumLoss > 0 ? `<span class="loss-text">RM ${sumLoss}</span>` : '-';
    let summaryDelay = lastRowDelay + 0.05; if (summaryDelay > 1.5) summaryDelay = 1.5; 

    const summaryRow = `<tr class="summary-row table-row-animate" style="animation-delay: ${summaryDelay}s"><td></td> <td style="text-transform: uppercase; letter-spacing: 1px;">Total</td> ${isSoldTable ? '<td></td>' : ''} <td>${costTotal}</td> <td>${sellTotal}</td> <td>${profitTotal}</td> <td>${lossTotal}</td> <td></td> <td></td> </tr>`;
    list.innerHTML += summaryRow;
}

// =======================================================
// PART 2: SALES & OVERVIEW (UPDATED WITH SECTIONS)
// =======================================================
async function fetchSales(searchQuery = "") {
    let query = db.from('sales_drops').select('*').order('drop_date', { ascending: false });
    if (searchQuery.trim() !== "") query = query.ilike('name', `%${searchQuery}%`);
    const { data, error } = await query;
    if (error) { console.error(error); return; }
    salesData = data || [];
    salesDataLoaded = true;
    renderSales();
}

function renderSales() {
    const listNow = document.getElementById('list-now');
    const listSoon = document.getElementById('list-soon');
    const listCompleted = document.getElementById('list-completed');
    
    listNow.innerHTML = "";
    listSoon.innerHTML = "";
    listCompleted.innerHTML = "";

    const droppingNow = [];
    const comingSoon = [];
    const completed = [];

    // CATEGORIZATION LOGIC
    const now = new Date();
    const today = new Date(); today.setHours(0,0,0,0);

    salesData.forEach(sale => {
        const dateCheck = new Date(sale.drop_date + "T00:00:00");
        const diffTime = dateCheck - today; 

        if (diffTime > 0) {
            comingSoon.push(sale);
        } 
        else if (diffTime < 0) {
            completed.push(sale);
        } 
        else {
            const dropDate = new Date(`${sale.drop_date}T${sale.drop_time}`);
            const timeDiff = dropDate - now;
            
            if (timeDiff <= 0) {
                droppingNow.push(sale);
            } else {
                comingSoon.push(sale);
            }
        }
    });

    // SORTING LOGIC
    droppingNow.sort((a, b) => new Date(`${a.drop_date}T${a.drop_time}`) - new Date(`${b.drop_date}T${b.drop_time}`));
    comingSoon.sort((a, b) => new Date(`${a.drop_date}T${a.drop_time}`) - new Date(`${b.drop_date}T${b.drop_time}`));
    completed.sort((a, b) => new Date(`${b.drop_date}T${b.drop_time}`) - new Date(`${a.drop_date}T${a.drop_time}`));

    // RENDER SECTIONS
    renderSalesList(listNow, droppingNow);
    renderSalesList(listSoon, comingSoon);
    renderSalesList(listCompleted, completed);

    // EMPTY STATE HANDLING
    const totalVisible = droppingNow.length + comingSoon.length + completed.length;
    const emptyState = document.getElementById('sales-empty-state');
    
    if (totalVisible === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
    }

    document.getElementById('section-now').style.display = droppingNow.length > 0 ? 'block' : 'none';
    document.getElementById('section-soon').style.display = comingSoon.length > 0 ? 'block' : 'none';
    document.getElementById('section-completed').style.display = completed.length > 0 ? 'block' : 'none';
}

function renderSalesList(container, items) {
    if (items.length === 0) return;

    items.forEach((sale, index) => {
        const { statusText, statusClass } = getSalesStatus(sale.drop_date, sale.drop_time);
        const dateObj = new Date(sale.drop_date);
        const formattedDate = dateObj.toLocaleDateString('en-GB'); 
        let delay = index * 0.05;
        
        const card = `
            <div class="sales-card" style="animation-delay: ${delay}s" onclick="openSalesOverview('${sale.id}', '${sale.name}', '${formattedDate}', '${sale.drop_date}', '${sale.drop_time}')">
                <div class="sales-info">
                    <span class="sales-name">${sale.name}</span>
                    <div class="sales-meta">
                        <span>${formattedDate}</span>
                        <span style="opacity: 0.3">•</span>
                        <span class="sales-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="sales-actions">
                    <button class="edit-btn" onclick="event.stopPropagation(); openEditSalesModal('${sale.id}', '${sale.name}', '${sale.drop_date}', '${sale.drop_time}')">Edit</button>
                    <button class="delete-btn" onclick="event.stopPropagation(); openDeleteSalesModal('${sale.id}')">Delete</button>
                    <svg class="arrow-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>`;
        container.innerHTML += card;
    });
}

function openSalesOverview(id, name, displayDate, rawDate, rawTime) {
    currentSalesDropId = id;
    document.getElementById('overview-title').innerText = name;
    document.getElementById('overview-date').innerText = displayDate;
    const { statusText, statusClass } = getSalesStatus(rawDate, rawTime);
    const statusEl = document.getElementById('overview-status');
    statusEl.innerText = statusText;
    statusEl.className = `sales-status ${statusClass}`;
    showPage('sales-overview');
    
    const input = document.getElementById('overview-search-box');
    input.value = "";
    document.getElementById('clear-ov-search').style.display = 'none';

    fetchSalesItems(id);
}

async function fetchSalesItems(dropId, searchQuery = "") {
    if (!dropId) return;
    
    let query = db.from('sales_items').select('*, items(*)').eq('sale_id', dropId);
    
    const { data, error } = await query;
    if (error) { console.error(error); return; }

    const flatItems = data.map(row => row.items).filter(item => item !== null);

    const search = searchQuery.toLowerCase();
    const filteredItems = searchQuery.trim() === "" 
        ? flatItems 
        : flatItems.filter(i => i.name.toLowerCase().includes(search));

    const clothItems = []; const pantItems = []; const accItems = []; const soldItems = [];
    currentDropItemIds.clear(); 

    let totalSold = 0; let totalItems = filteredItems.length;
    let totalCost = 0, totalSell = 0, totalProfit = 0, totalLoss = 0;

    filteredItems.forEach(item => {
        currentDropItemIds.add(item.id); 
        const cost = parseFloat(item.cost_price) || 0;
        const sell = parseFloat(item.sell_price) || 0;
        
        if (item.status === 'sold') {
            totalSold++;
            const diff = sell - cost;
            totalCost += cost; totalSell += sell;
            if (diff >= 0) totalProfit += diff; else totalLoss += Math.abs(diff);
            soldItems.push(item);
        } else {
            if (item.category === 'Cloth') clothItems.push(item);
            else if (item.category === 'Pant') pantItems.push(item);
            else if (item.category === 'Accessories') accItems.push(item);
        }
    });

    const totalVisible = clothItems.length + pantItems.length + accItems.length + soldItems.length;
    const emptyState = document.getElementById('ov-empty-state');
    
    if (searchQuery.trim() !== "" && totalVisible === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
    }

    renderTableSection('ov-list-cloth', 'ov-count-cloth', clothItems, false, searchQuery);
    renderTableSection('ov-list-pant', 'ov-count-pant', pantItems, false, searchQuery);
    renderTableSection('ov-list-accessories', 'ov-count-accessories', accItems, false, searchQuery);
    renderTableSection('ov-list-sold', 'ov-count-sold', soldItems, true, searchQuery);
    
    updateAnalytics(totalItems, totalSold, totalSell, totalProfit, totalLoss);
}

function updateAnalytics(total, sold, salesVal, profit, loss) {
    const cleanIncome = profit - loss;
    const percent = total === 0 ? 0 : Math.round((sold / total) * 100);
    document.getElementById('progress-percent').innerText = `${percent}% Sold`;
    document.getElementById('progress-fill').style.width = `${percent}%`;
    document.getElementById('stat-sold').innerText = sold;
    document.getElementById('stat-available').innerText = total - sold;
    document.getElementById('stat-sales-total').innerText = `RM ${salesVal}`;
    document.getElementById('stat-profit').innerText = `RM ${profit}`;
    document.getElementById('stat-loss').innerText = `RM ${loss}`;
    document.getElementById('stat-clean').innerText = `RM ${cleanIncome}`;
    
    const calcBase = cleanIncome > 0 ? cleanIncome : 0;
    const rolling = Math.floor(calcBase * 0.5);
    const saving = Math.floor(calcBase * 0.3);
    const personal = calcBase - rolling - saving; 
    document.getElementById('val-rolling').innerText = `RM ${rolling}`;
    document.getElementById('val-saving').innerText = `RM ${saving}`;
    document.getElementById('val-personal').innerText = `RM ${personal}`;
}

// ... (Rest of existing add/edit/delete logic)
function openAddToDropModal() { document.getElementById('add-choice-modal').style.display = 'flex'; }
function closeChoiceModal() { document.getElementById('add-choice-modal').style.display = 'none'; }
function openManualAddModal() { closeChoiceModal(); openModal(); }

async function addItem() {
    const rawName = document.getElementById('inp-name').value;
    const category = document.getElementById('inp-category').value;
    const cost = document.getElementById('inp-cost').value;
    const price = document.getElementById('inp-price').value;
    if (!rawName || !price) { alert("Required fields missing"); return; }
    const formattedName = toTitleCase(rawName);
    const { data, error } = await db.from('items').insert({ name: formattedName, category, cost_price: cost, sell_price: price, status: 'available' }).select();
    if (error) { alert(error.message); return; }
    if (currentSalesDropId && data && data[0]) {
        const newItem = data[0];
        const { error: linkError } = await db.from('sales_items').insert({ sale_id: currentSalesDropId, item_id: newItem.id });
        if (linkError) console.error("Error linking item:", linkError);
    }
    closeModal(); document.getElementById('inp-name').value = ""; document.getElementById('inp-cost').value = ""; document.getElementById('inp-price').value = ""; 
    if (currentSalesDropId) fetchSalesItems(currentSalesDropId); else fetchItems();
    fetchInventoryTotal(); // UPDATE COUNT
}

function openSelectInventoryModal() {
    closeChoiceModal();
    document.getElementById('select-inv-modal').style.display = 'flex';
    document.getElementById('select-inv-search').value = ""; 
    loadInventoryForSelection(); 
}
function closeSelectInvModal() {
    document.getElementById('select-inv-modal').style.display = 'none';
    selectedInventoryIds.clear();
}
async function loadInventoryForSelection() {
    const { data, error } = await db.from('items').select('*').eq('status', 'available');
    if (error) { console.error(error); return; }
    const validItems = data ? data.filter(item => !currentDropItemIds.has(item.id)) : [];
    cachedInventoryData = validItems;
    activeSelectTab = 'Cloth'; 
    updateTabUI();
    renderInventorySelection();
    updateSelectionCounter();
}
function switchSelectTab(category) {
    activeSelectTab = category;
    updateTabUI();
    renderInventorySelection();
}
function updateTabUI() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${activeSelectTab}`).classList.add('active');
}
function updateSelectionCounter() {
    const count = selectedInventoryIds.size;
    document.getElementById('selection-count').innerText = `${count} items selected`;
}
function renderInventorySelection() {
    const listContainer = document.getElementById('inventory-selection-list');
    listContainer.innerHTML = "";
    const searchVal = document.getElementById('select-inv-search').value.toLowerCase();
    const filteredData = cachedInventoryData.filter(item => {
        const matchesTab = item.category === activeSelectTab;
        const matchesSearch = item.name.toLowerCase().includes(searchVal);
        return matchesTab && matchesSearch;
    });
    if (filteredData.length === 0) {
        listContainer.innerHTML = "<div style='padding:20px; text-align:center; color:#666'>No available items found.</div>";
        return;
    }
    filteredData.forEach(item => {
        const row = document.createElement('div');
        row.className = 'select-item-row';
        if (selectedInventoryIds.has(item.id)) row.classList.add('selected');
        row.innerHTML = `<span>${item.name} <span style="color:#666; font-size:12px">(${item.category})</span></span><span style="color:#888; font-size:12px">RM ${item.sell_price}</span>`;
        row.onclick = () => toggleSelection(row, item.id);
        listContainer.appendChild(row);
    });
}
function toggleSelection(row, id) {
    if (selectedInventoryIds.has(id)) { selectedInventoryIds.delete(id); row.classList.remove('selected'); } 
    else { selectedInventoryIds.add(id); row.classList.add('selected'); }
    updateSelectionCounter();
}
async function confirmAddToDrop() {
    if (selectedInventoryIds.size === 0) return;
    const ids = Array.from(selectedInventoryIds);
    const insertData = ids.map(id => ({ sale_id: currentSalesDropId, item_id: id }));
    const { error } = await db.from('sales_items').insert(insertData);
    if (!error) { closeSelectInvModal(); fetchSalesItems(currentSalesDropId); } else { alert(error.message); }
}

function openRemoveModal(itemId) { itemToRemoveId = itemId; document.getElementById('remove-modal').style.display = 'flex'; }
function closeRemoveModal() { itemToRemoveId = null; document.getElementById('remove-modal').style.display = 'none'; }
async function confirmRemove() {
    if (!itemToRemoveId || !currentSalesDropId) return;
    const { error } = await db.from('sales_items').delete().match({ sale_id: currentSalesDropId, item_id: itemToRemoveId });
    if (!error) { closeRemoveModal(); fetchSalesItems(currentSalesDropId); } else { alert(error.message); }
}

function getSalesStatus(dateStr, timeStr) {
    const now = new Date();
    const today = new Date(); today.setHours(0,0,0,0);
    const dateCheck = new Date(dateStr + "T00:00:00");
    const diffTime = dateCheck - today; 
    if (diffTime > 0) { const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); return { statusText: `Happening in ${diffDays} days`, statusClass: 'status-upcoming' }; } 
    else if (diffTime < 0) { return { statusText: 'Completed', statusClass: 'status-completed' }; } 
    else { const dropDate = new Date(`${dateStr}T${timeStr}`); const timeDiff = dropDate - now; if (timeDiff <= 0) return { statusText: 'Now Dropping', statusClass: 'status-live' }; else { const hours = Math.floor(timeDiff / (1000 * 60 * 60)); const mins = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60)); let timeString = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`; return { statusText: `Happening in ${timeString}`, statusClass: 'status-upcoming' }; } }
}
async function updateStatus(id, selectEl) { 
    const newStatus = selectEl.value; 
    selectEl.className = `status-select ${newStatus}`; 
    await db.from('items').update({ status: newStatus }).eq('id', id); 
    if (currentSalesDropId) fetchSalesItems(currentSalesDropId); else fetchItems(); 
    fetchInventoryTotal(); // UPDATE COUNT
}
async function saveEditItem() { const id = document.getElementById('edit-id').value; const rawName = document.getElementById('edit-name').value; const category = document.getElementById('edit-category').value; const cost = document.getElementById('edit-cost').value; const price = document.getElementById('edit-price').value; const formattedName = toTitleCase(rawName); const { error } = await db.from('items').update({ name: formattedName, category, cost_price: cost, sell_price: price }).eq('id', id); if (!error) { closeEditModal(); if(currentSalesDropId) fetchSalesItems(currentSalesDropId); else fetchItems(); fetchInventoryTotal(); } else alert(error.message); }
async function confirmDelete() { if (!itemToDeleteId) return; const { error } = await db.from('items').delete().eq('id', itemToDeleteId); if (!error) { closeDeleteModal(); if(currentSalesDropId) fetchSalesItems(currentSalesDropId); else fetchItems(); fetchInventoryTotal(); } else alert(error.message); }
function openModal() { document.getElementById('add-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('add-modal').style.display = 'none'; }
function openEditModal(id, name, cat, cost, price) { document.getElementById('edit-id').value = id; document.getElementById('edit-name').value = name; document.getElementById('edit-category').value = cat; document.getElementById('edit-cost').value = cost; document.getElementById('edit-price').value = price; document.getElementById('edit-modal').style.display = 'flex'; }
function closeEditModal() { document.getElementById('edit-modal').style.display = 'none'; }
function openDeleteModal(id) { itemToDeleteId = id; document.getElementById('delete-modal').style.display = 'flex'; document.querySelector('#delete-modal .danger-btn').onclick = confirmDelete; }
function closeDeleteModal() { itemToDeleteId = null; saleToDeleteId = null; document.getElementById('delete-modal').style.display = 'none'; }

// --- SALES CRUD (UPDATED TO USE NEW TIME LOGIC) ---

function openSalesModal() {
    document.getElementById('sales-id').value = ""; 
    document.getElementById('sales-modal-title').innerText = "New Sales Drop";
    document.getElementById('sales-name').value = "";
    document.getElementById('sales-date').value = "";
    
    // Clear/Set Default Time
    setTimePickerFromValue(""); // Sets to current time approx
    
    document.getElementById('sales-modal').style.display = 'flex';
}

function openEditSalesModal(id, name, date, time) {
    document.getElementById('sales-id').value = id; 
    document.getElementById('sales-modal-title').innerText = "Edit Sales Drop";
    document.getElementById('sales-name').value = name;
    document.getElementById('sales-date').value = date;
    
    // Set Custom Time Picker
    setTimePickerFromValue(time);
    
    document.getElementById('sales-modal').style.display = 'flex';
}

function closeSalesModal() {
    document.getElementById('sales-modal').style.display = 'none';
    document.getElementById('time-presets').classList.remove('show');
}

async function saveSalesDrop() {
    const id = document.getElementById('sales-id').value;
    const name = document.getElementById('sales-name').value;
    const date = document.getElementById('sales-date').value;
    
    // READ HIDDEN INPUT (It's updated by syncTimeInput)
    const time = document.getElementById('sales-time').value; 

    if (!name || !date || !time) { alert("Please fill all fields"); return; }

    const formattedName = toTitleCase(name);

    if (id) {
        const { error } = await db.from('sales_drops').update({ name: formattedName, drop_date: date, drop_time: time }).eq('id', id);
        if (!error) { closeSalesModal(); fetchSales(); } else { alert(error.message); }
    } else {
        const { error } = await db.from('sales_drops').insert({ name: formattedName, drop_date: date, drop_time: time });
        if (!error) { closeSalesModal(); fetchSales(); } else { alert(error.message); }
    }
}

function openDeleteSalesModal(id) {
    saleToDeleteId = id;
    document.getElementById('delete-modal').style.display = 'flex';
    document.querySelector('#delete-modal .danger-btn').onclick = confirmDeleteSales;
}

async function confirmDeleteSales() {
    if (!saleToDeleteId) return;
    const { error } = await db.from('sales_drops').delete().eq('id', saleToDeleteId);
    if (!error) { closeDeleteModal(); fetchSales(); } else { alert(error.message); }
    document.querySelector('#delete-modal .danger-btn').onclick = confirmDelete;
}

function showPage(pageId) { 
    document.getElementById('inventory-page').style.display = 'none'; 
    document.getElementById('sales-page').style.display = 'none'; 
    document.getElementById('sales-overview-page').style.display = 'none'; 
    document.getElementById(pageId + (pageId.includes('page') ? '' : '-page')).style.display = 'block'; 
    
    document.getElementById('btn-inv').classList.remove('active-btn'); 
    document.getElementById('btn-sales').classList.remove('active-btn'); 
    
    if (pageId === 'inventory') { 
        document.getElementById('btn-inv').classList.add('active-btn'); 
        currentSalesDropId = null; 
        triggerAnimation('inventory-page'); 
        fetchItems(); 
    } else if (pageId === 'sales') { 
        document.getElementById('btn-sales').classList.add('active-btn'); 
        currentSalesDropId = null; 
        triggerAnimation('sales-page'); 
        if (!salesDataLoaded) {
            fetchSales(); 
        }
    } else if (pageId === 'sales-overview') { 
        document.getElementById('btn-sales').classList.add('active-btn'); 
        triggerAnimation('sales-overview-page'); 
    } 
}

function toTitleCase(str) { return str.replace(/\w\S*/g, function(txt) { if (txt === txt.toUpperCase()) return txt; return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); }); }
function triggerAnimation(id) { const el = document.getElementById(id); el.classList.remove('animate-enter'); void el.offsetWidth; el.classList.add('animate-enter'); }
function setupEnterSubmit(modalId, func) { const modal = document.getElementById(modalId); if(modal) modal.querySelectorAll('input, select').forEach(i => { i.addEventListener('keyup', e => { if (e.key === 'Enter') func(); }); }); }
function toggleSortMenu() { document.getElementById('sort-menu').classList.toggle('show'); }