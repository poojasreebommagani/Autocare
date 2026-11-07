const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  token: localStorage.getItem("autocare_token"),
  user: null,
  tab: "overview",
  data: {},
  services: [],
  authMode: "login"
};

const api = async (url, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`/api${url}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

  return body;
};

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const money = n =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(n || 0));

const dateText = d => d ? String(d).slice(0, 10) : "—";
const roleIs = (...roles) => roles.includes(state.user?.role);

function notify(message, type = "success") {
  const el = $("#notice");
  el.textContent = message;
  el.className = `notice ${type}`;

  window.scrollTo({ top: 0, behavior: "smooth" });

  setTimeout(() => {
    if (el.textContent === message) el.classList.add("hidden");
  }, 6000);
}

function showAuth() {
  $("#auth-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
  $("#logout-btn").classList.add("hidden");
  $("#user-chip").classList.add("hidden");
}

function showApp() {
  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#logout-btn").classList.remove("hidden");
  $("#user-chip").classList.remove("hidden");

  $("#user-chip").textContent = `${state.user.name} · ${state.user.role}`;
  $("#welcome-title").textContent = `Hello, ${state.user.name.split(" ")[0]}`;
  $("#welcome-subtitle").textContent =
    `Your role: ${state.user.role}. Manage your vehicle service in one place.`;
}

function setAuthTab(tab) {
  state.authMode = tab;

  $$(".tab").forEach(b =>
    b.classList.toggle("active", b.dataset.authTab === tab)
  );

  $("#login-form").classList.toggle("hidden", tab === "register");
  $("#register-form").classList.toggle("hidden", tab !== "register");

  if ($("#login-title")) {
    $("#login-title").textContent =
      tab === "admin" ? "Administrator sign in" : "Welcome back";
  }

  if ($("#login-description")) {
    $("#login-description").textContent = tab === "admin"
      ? "Use an account that has been assigned the admin role."
      : "Sign in to your AutoCare account.";
  }
}

$$("[data-auth-tab]").forEach(b =>
  b.addEventListener("click", () => setAuthTab(b.dataset.authTab))
);

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();

  const f = Object.fromEntries(new FormData(e.currentTarget));

  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify(f)
    });

    if (state.authMode === "admin" && result.user?.role !== "admin") {
      throw new Error(
        "This account is not an administrator. Ask an existing administrator to assign the admin role."
      );
    }

    await establishSession(result);
  } catch (err) {
    alert(err.message);
  }
});

$("#register-form").addEventListener("submit", async e => {
  e.preventDefault();

  const f = Object.fromEntries(new FormData(e.currentTarget));

  try {
    await establishSession(
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify(f)
      })
    );
  } catch (err) {
    alert(err.message);
  }
});

async function establishSession(result) {
  state.token = result.token;
  state.user = result.user;

  localStorage.setItem("autocare_token", state.token);

  showApp();
  await loadAll();
  notify("Welcome to AutoCare.");
}

$("#logout-btn").addEventListener("click", () => {
  state.token = null;
  state.user = null;
  state.data = {};

  localStorage.removeItem("autocare_token");
  showAuth();
});

$("#refresh-btn").addEventListener("click", async () => {
  try {
    await loadAll();
    notify("Data refreshed.", "info");
  } catch (e) {
    notify(e.message, "error");
  }
});

async function loadAll() {
  const me = await api("/me");
  state.user = me.user;
  showApp();

  const jobs = [
    ["services", "/service-types"],
    ["vehicles", "/vehicles"],
    ["bookings", "/bookings"],
    ["invoices", "/invoices"]
  ];

  for (const [key, url] of jobs) {
    try {
      state.data[key] = await api(url);
    } catch (e) {
      state.data[key] = [];
    }
  }

  if (roleIs("staff", "admin")) {
    try {
      state.data.summary = await api("/admin/summary");
    } catch (e) {}

    try {
      state.data.mechanics = await api("/mechanics");
    } catch (e) {
      state.data.mechanics = [];
    }

    try {
      state.data.inventory = await api("/inventory");
    } catch (e) {
      state.data.inventory = [];
    }
  }

  if (roleIs("admin")) {
    try {
      state.data.users = await api("/admin/users");
    } catch (e) {
      state.data.users = [];
    }

    try {
      state.data.feedback = await api("/admin/feedback");
    } catch (e) {
      state.data.feedback = [];
    }
  }

  render();
}

const navForRole = () => {
  const common = [
    ["overview", "Overview"],
    ["vehicles", "My vehicles"],
    ["bookings", "Bookings"],
    ["services", "Services"],
    ["invoices", "Invoices"]
  ];

  if (roleIs("staff", "admin")) {
    common.push(["operations", "Workshop"], ["inventory", "Inventory"]);
  }

  if (roleIs("admin")) {
    common.push(["feedback", "Feedback"], ["users", "User management"]);
  }

  return common;
};

function render() {
  const nav = navForRole();

  if (!nav.some(x => x[0] === state.tab)) {
    state.tab = "overview";
  }

  $("#main-nav").innerHTML = nav.map(([id, label]) =>
    `<button class="nav-btn ${state.tab === id ? "active" : ""}"
      data-tab="${id}">${label}</button>`
  ).join("");

  $$(".nav-btn").forEach(b =>
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      render();
    })
  );

  renderStats();

  const view = {
    overview: renderOverview,
    vehicles: renderVehicles,
    bookings: renderBookings,
    services: renderServices,
    invoices: renderInvoices,
    operations: renderOperations,
    inventory: renderInventory,
    users: renderUsers,
    feedback: renderFeedback
  }[state.tab] || renderOverview;

  $("#content").innerHTML = view();
  bindContentEvents();
}function renderStats() {
  const bookings = state.data.bookings || [];
  const vehicles = state.data.vehicles || [];
  const invoices = state.data.invoices || [];

  const items = roleIs("staff", "admin") ? [
    ["Bookings", state.data.summary?.total_bookings ?? bookings.length,
      "All recorded service bookings"],
    ["Open jobs",
      state.data.summary?.open_bookings ??
      bookings.filter(b => !["Closed", "Cancelled"].includes(b.status)).length,
      "Jobs not yet closed"],
    ["Vehicles", state.data.summary?.total_vehicles ?? vehicles.length,
      "Registered vehicles"],
    ["Payments received",
      money(state.data.summary?.received_revenue ??
        invoices.filter(i => i.status === "Paid")
          .reduce((s, i) => s + Number(i.total_amount), 0)),
      "Recorded payments"]
  ] : [
    ["My vehicles", vehicles.length, "Registered vehicles"],
    ["My bookings", bookings.length, "All service requests"],
    ["Active bookings",
      bookings.filter(b => !["Closed", "Cancelled"].includes(b.status)).length,
      "In progress or awaiting service"],
    ["Invoices", invoices.length, "Billing records"]
  ];

  $("#stats").innerHTML = items.map(([label, value, note]) =>
    `<div class="stat-card">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
      <div class="stat-note">${esc(note)}</div>
    </div>`
  ).join("");
}

function panel(title, subtitle, body, wide = false) {
  return `<section class="panel ${wide ? "wide" : ""}">
    <div class="panel-head">
      <div>
        <h2>${title}</h2>
        ${subtitle ? `<p>${subtitle}</p>` : ""}
      </div>
    </div>
    ${body}
  </section>`;
}

function table(headers, rows) {
  if (!rows.length) {
    return `<div class="empty">
      Nothing here yet. Items will appear after you add or book them.
    </div>`;
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;
}

function badge(status) {
  let c = "blue";

  if (["Closed", "Completed", "Paid", "Approved"].includes(status)) c = "green";
  if (["Pending", "Awaiting Approval", "Partially Paid", "Inspection"].includes(status)) c = "amber";
  if (["Cancelled", "Rejected", "Unpaid"].includes(status)) c = "red";

  return `<span class="badge ${c}">${esc(status || "—")}</span>`;
}

function renderOverview() {
  const recent = (state.data.bookings || []).slice(0, 5);

  const rows = recent.map(b =>
    `<tr>
      <td>#${b.id}</td>
      <td>${esc(b.service_name)}</td>
      <td>${esc(b.registration_number)}</td>
      <td>${badge(b.status)}</td>
      <td>${dateText(b.booking_date)}</td>
    </tr>`
  );

  let body = panel(
    "Recent bookings",
    "Latest service activity",
    table(["Booking", "Service", "Vehicle", "Status", "Date"], rows),
    true
  );

  if (roleIs("staff", "admin")) {
    const s = state.data.summary || {};

    body += panel(
      "Workshop snapshot",
      "Current operational overview",
      `<div class="field-grid">
        <div class="stat-card">
          <div class="stat-label">Registered users</div>
          <div class="stat-value">${s.total_users ?? "—"}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Low-stock parts</div>
          <div class="stat-value">${s.low_stock_parts ?? "—"}</div>
        </div>
      </div>
      <p class="footnote">
        Keep booking statuses, estimates and payments up to date for accurate reports.
      </p>`
    );
  } else {
    body += panel(
      "Quick action",
      "Need a service?",
      `<p class="muted">
        Add your vehicle, choose a service and book a suitable date and time.
      </p>
      <button class="btn btn-primary" data-goto="bookings">Book a service</button>`
    );
  }

  return body;
}

function renderVehicles() {
  const vehicleRows = (state.data.vehicles || []).map(v =>
    `<tr>
      <td>
        <strong>${esc(v.registration_number)}</strong>
        <div class="muted">${esc(v.make)} ${esc(v.model)}</div>
      </td>
      <td>${esc(v.manufacture_year || "—")}</td>
      <td>${esc(v.fuel_type || "—")}</td>
      <td>${Number(v.odometer_km || 0).toLocaleString("en-IN")} km</td>
    </tr>`
  );

  let body = "";

  if (roleIs("customer", "admin")) {
    body += panel(
      "Add a vehicle",
      "Use the registration number shown on your vehicle",
      `<form id="vehicle-form">
        <div class="field-grid">
          <div class="field">
            <label>Registration number</label>
            <input name="registration_number" required placeholder="TS 00 AB 1234">
          </div>
          <div class="field">
            <label>Make</label>
            <input name="make" required placeholder="Maruti Suzuki">
          </div>
          <div class="field">
            <label>Model</label>
            <input name="model" required placeholder="Swift">
          </div>
          <div class="field">
            <label>Manufacture year</label>
            <input name="manufacture_year" type="number" min="1950" max="2100" placeholder="2022">
          </div>
          <div class="field">
            <label>Fuel type</label>
            <select name="fuel_type">
              <option value="petrol">Petrol</option>
              <option value="diesel">Diesel</option>
              <option value="electric">Electric</option>
              <option value="hybrid">Hybrid</option>
              <option value="cng">CNG</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="field">
            <label>Odometer (km)</label>
            <input name="odometer_km" type="number" min="0" value="0" required>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary">Save vehicle</button>
        </div>
      </form>`
    );
  }

  body += panel(
    roleIs("staff", "admin") ? "Registered vehicles" : "My vehicles",
    "Vehicle records",
    table(["Vehicle", "Year", "Fuel", "Odometer"], vehicleRows),
    true
  );

  return body;
}

function renderBookings() {
  const vehicles = state.data.vehicles || [];
  const services = state.data.services || [];
  let body = "";

  if (roleIs("customer", "admin")) {
    body += panel(
      "Book a service",
      "Choose a vehicle, service and appointment time",
      vehicles.length ? `<form id="booking-form">
        <div class="field-grid">
          <div class="field">
            <label>Vehicle</label>
            <select name="vehicle_id" required>
              ${vehicles
                .filter(v => !v.owner_name || v.user_id === state.user.id)
                .map(v => `<option value="${v.id}">
                  ${esc(v.registration_number)} · ${esc(v.make)} ${esc(v.model)}
                </option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Service type</label>
            <select name="service_type_id" required>
              ${services.map(s => `<option value="${s.id}">
                ${esc(s.name)} · ${money(s.base_price)}
              </option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Date</label>
            <input name="booking_date" type="date"
              min="${new Date().toISOString().slice(0, 10)}" required>
          </div>
          <div class="field">
            <label>Preferred time</label>
            <input name="booking_time" type="time" required value="10:00">
          </div>
          <div class="field full-field">
            <label>Issue description</label>
            <textarea name="issue_description"
              placeholder="Describe any sound, warning light, or service request"></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary">Submit booking</button>
        </div>
      </form>` : `<div class="empty">Add a vehicle first before booking a service.</div>`
    );
  }

  const rows = (state.data.bookings || []).map(b => {
    const action = roleIs("staff", "admin")
      ? `<div class="inline-form">
          <select data-status-id="${b.id}">
            ${["Pending", "Confirmed", "Inspection", "Awaiting Approval",
              "In Progress", "Quality Check", "Completed", "Invoiced",
              "Closed", "Cancelled"]
              .map(s => `<option ${s === b.status ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select>
          <button class="btn btn-small btn-soft" data-update-status="${b.id}">Save</button>
        </div>`
      : "";

    // UPDATED: estimate total includes labor, parts, and service charge.
    const estimate = b.estimate_id
      ? `${money(
          Number(b.labor_cost || 0) +
          Number(b.parts_cost || 0) +
          Number(b.service_cost || 0)
        )} ${badge(b.estimate_status)}`
      : "—";

    const customer = roleIs("staff", "admin")
      ? `<div class="muted">${esc(b.customer_name || "")}</div>`
      : "";

    const approval = roleIs("customer", "admin") &&
      b.estimate_id &&
      b.estimate_status === "Pending"
      ? `<div class="action-row">
          <button class="btn btn-small btn-primary"
            data-estimate-decision="${b.estimate_id}" data-decision="Approved">Approve estimate</button>
          <button class="btn btn-small btn-danger"
            data-estimate-decision="${b.estimate_id}" data-decision="Rejected">Reject estimate</button>
        </div>`
      : "";

    return `<tr>
      <td>#${b.id}${customer}<div class="muted">${esc(b.registration_number)}</div></td>
      <td>${esc(b.service_name)}
        <div class="muted">${dateText(b.booking_date)} ${esc(String(b.booking_time || "").slice(0, 5))}</div>
      </td>
      <td>${badge(b.status)}</td>
      <td>${estimate}${approval}</td>
      <td>${action}</td>
    </tr>`;
  });

  body += panel(
    "Booking list",
    "Track appointments, estimates, and service status",
    table(["Booking / Vehicle", "Service / Appointment", "Status", "Estimate", "Actions"], rows),
    true
  );

  if (roleIs("staff", "admin")) {
    body += panel(
      "Inspection record",
      "Record inspection findings",
      `<form id="inspection-form">
        <div class="field-grid">
          <div class="field">
            <label>Booking ID</label>
            <input name="booking_id" type="number" min="1" required>
          </div>
          <div class="field">
            <label>Inspection notes</label>
            <input name="notes" required placeholder="e.g. Brake pad worn">
          </div>
          <div class="field full-field">
            <label>Findings / recommended work</label>
            <textarea name="findings"></textarea>
          </div>
        </div>
        <button class="btn btn-primary">Save inspection</button>
      </form>

      <div class="subsection">
        <h3>Create or update estimate</h3>
        <form id="estimate-form">
          <div class="field-grid">
            <div class="field">
              <label>Booking ID</label>
              <input name="booking_id" type="number" min="1" required>
            </div>
            <div class="field">
              <label>Labor cost (₹)</label>
              <input name="labor_cost" type="number" min="0" step=".01" value="0" required>
            </div>
            <div class="field">
              <label>Parts cost (₹)</label>
              <input name="parts_cost" type="number" min="0" step=".01" value="0" required>
            </div>
            <div class="field">
              <label>Service charge (₹)</label>
              <input name="service_cost" type="number" min="0" step=".01" value="0" required>
            </div>
            <div class="field">
              <label>Notes</label>
              <input name="notes" placeholder="Work included">
            </div>
          </div>
          <button class="btn btn-primary">Save estimate</button>
        </form>
      </div>`
    );
  }

  return body;
}function renderServices() {
  const cards = (state.data.services || []).map(s =>
    `<div class="service-card">
      <div>
        <strong>${esc(s.name)}</strong>
        <p>${esc(s.description || "Vehicle service")}</p>
        <p>Approx. duration: ${s.duration_minutes} minutes</p>
      </div>
      <div class="service-price">${money(s.base_price)}</div>
    </div>`
  ).join("");

  return panel(
    "Available services",
    "Prices are indicative; final cost may vary after inspection",
    cards || `<div class="empty">No active service types.</div>`,
    true
  );
}

function renderInvoices() {
  const rows = (state.data.invoices || []).map(i =>
    `<tr>
      <td>#${i.id}<div class="muted">Booking #${i.booking_number}</div></td>
      <td>
        ${esc(i.registration_number)}
        ${roleIs("staff", "admin") ? `<div class="muted">${esc(i.customer_name)}</div>` : ""}
      </td>
      <td class="money">${money(i.total_amount)}</td>
      <td>${badge(i.status)}</td>
      <td>${dateText(i.issued_at)}</td>
      <td>
        ${roleIs("staff", "admin") && i.status !== "Paid"
          ? `<button class="btn btn-small btn-primary"
              data-record-payment="${i.id}" data-total="${i.total_amount}">Record payment</button>`
          : ""}
      </td>
    </tr>`
  );

  let body = panel(
    "Invoices",
    "Billing records and payment status",
    table(["Invoice", "Vehicle", "Total", "Status", "Issued", "Action"], rows),
    true
  );

  if (roleIs("staff", "admin")) {
    body += panel(
      "Generate invoice",
      "Only approved estimates can be invoiced",
      `<form id="invoice-form" class="inline-form">
        <label for="invoice-booking">Booking ID</label>
        <input id="invoice-booking" name="booking_id" class="input"
          type="number" min="1" required style="max-width:140px">

        <label for="tax-rate">Tax rate</label>
        <select id="tax-rate" name="tax_rate" class="input" style="max-width:130px">
          <option value=".18">18%</option>
          <option value=".05">5%</option>
          <option value="0">0%</option>
        </select>

        <button class="btn btn-primary">Generate invoice</button>
      </form>
      <p class="footnote">
      
      </p>`
    );
  }

  return body;
}

function renderOperations() {
  if (!roleIs("staff", "admin")) {
    return panel("Workshop", "Access restricted",
      `<div class="empty">This section is for workshop staff.</div>`);
  }

  const bookings = state.data.bookings || [];

  const bookingOptions = bookings.map(b =>
    `<option value="${b.id}">#${b.id} · ${esc(b.registration_number)} · ${esc(b.service_name)}</option>`
  ).join("");

  const mechanics = state.data.mechanics || [];

  const rows = bookings.map(b =>
    `<tr>
      <td>#${b.id}</td>
      <td>${esc(b.customer_name || "")}</td>
      <td>${esc(b.registration_number)}</td>
      <td>${esc(b.service_name)}</td>
      <td>${badge(b.status)}</td>
    </tr>`
  );

  return panel(
    "Workshop operations",
    "Assign a mechanic and follow service jobs",
    `<form id="assignment-form">
      <div class="field-grid">
        <div class="field">
          <label>Booking</label>
          <select name="booking_id" required>${bookingOptions}</select>
        </div>
        <div class="field">
          <label>Mechanic</label>
          <select name="mechanic_id" required>
            ${mechanics.map(m => `<option value="${m.id}">
              ${esc(m.name)} · ${esc(m.specialization || "General")}
            </option>`).join("")}
          </select>
        </div>
      </div>
      <button class="btn btn-primary">Assign mechanic</button>
      <p class="footnote">
       
      </p>
    </form>
    <div class="subsection">
      <h3>All service jobs</h3>
      ${table(["Booking", "Customer", "Vehicle", "Service", "Status"], rows)}
    </div>`,
    true
  );
}

function renderInventory() {
  if (!roleIs("staff", "admin")) {
    return panel("Inventory", "Access restricted",
      `<div class="empty">This section is for staff.</div>`);
  }

  const rows = (state.data.inventory || []).map(p =>
    `<tr>
      <td><strong>${esc(p.part_name)}</strong><div class="muted">${esc(p.sku)}</div></td>
      <td>${money(p.unit_price)}</td>
      <td>${p.stock_quantity <= p.reorder_level
        ? `<span class="badge red">${p.stock_quantity} · Low</span>`
        : p.stock_quantity}</td>
      <td>${p.reorder_level}</td>
      <td>
        <button class="btn btn-small btn-soft"
          data-edit-stock="${p.id}" data-stock="${p.stock_quantity}">Update stock</button>
      </td>
    </tr>`
  );

  return panel(
    "Spare-parts inventory",
    "Track stock levels and reorder thresholds",
    `<form id="part-form">
      <div class="field-grid">
        <div class="field">
          <label>Part name</label>
          <input name="part_name" required placeholder="Oil filter">
        </div>
        <div class="field">
          <label>SKU</label>
          <input name="sku" required placeholder="OIL-FLT-001">
        </div>
        <div class="field">
          <label>Unit price (₹)</label>
          <input name="unit_price" type="number" min="0" step=".01" required>
        </div>
        <div class="field">
          <label>Initial stock</label>
          <input name="stock_quantity" type="number" min="0" value="0" required>
        </div>
        <div class="field">
          <label>Reorder level</label>
          <input name="reorder_level" type="number" min="0" value="5" required>
        </div>
      </div>
      <button class="btn btn-primary">Add spare part</button>
    </form>
    <div class="subsection">
      ${table(["Part / SKU", "Unit price", "Stock", "Reorder level", "Action"], rows)}
    </div>
    <p class="footnote">
      
    </p>`,
    true
  );
}

function renderFeedback() {
  if (!roleIs("admin")) {
    return panel("Feedback", "Administrator access required",
      '<div class="empty">This section is only available to administrators.</div>');
  }

  const rows = (state.data.feedback || []).map(f =>
    `<tr>
      <td>#${esc(f.id)}</td>
      <td>${esc(f.customer_name || "Customer")}<div class="muted">${esc(f.customer_email || "")}</div></td>
      <td>#${esc(f.booking_id)}<div class="muted">${esc(f.service_name || "")}</div></td>
      <td>${"★".repeat(Number(f.rating || 0))}${"☆".repeat(5 - Number(f.rating || 0))}</td>
      <td>${esc(f.comments || "—")}</td>
      <td>${dateText(f.created_at)}</td>
    </tr>`
  );

  return panel(
    "Customer feedback",
    "Review ratings and comments submitted after completed services",
    table(["ID", "Customer", "Booking / service", "Rating", "Comments", "Date"], rows),
    true
  );
}

function renderUsers() {
  if (!roleIs("admin")) return "";

  const rows = (state.data.users || []).map(u =>
    `<tr>
      <td><strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)}</div></td>
      <td>${esc(u.phone || "—")}</td>
      <td>${esc(u.role)}</td>
      <td>
        <select data-role-user="${u.id}">
          ${["customer", "staff", "mechanic", "admin"]
            .map(r => `<option ${u.role === r ? "selected" : ""}>${r}</option>`)
            .join("")}
        </select>
      </td>
      <td><button class="btn btn-small btn-soft" data-save-role="${u.id}">Save role</button></td>
    </tr>`
  );

  return panel(
    "User and role management",
    "Assign access only to trusted demo accounts",
    table(["User", "Phone", "Current role", "New role", "Action"], rows),
    true
  );
}

function bindContentEvents() {
  $$("[data-goto]").forEach(b =>
    b.addEventListener("click", () => {
      state.tab = b.dataset.goto;
      render();
    })
  );

  const onSubmit = (id, fn) => {
    const form = $(id);

    if (form) {
      form.addEventListener("submit", async e => {
        e.preventDefault();

        try {
          await fn(Object.fromEntries(new FormData(form)));
          await loadAll();
          notify("Saved successfully.");
        } catch (err) {
          notify(err.message, "error");
        }
      });
    }
  };

  onSubmit("#vehicle-form", f =>
    api("/vehicles", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        manufacture_year: f.manufacture_year ? Number(f.manufacture_year) : null,
        odometer_km: Number(f.odometer_km)
      })
    })
  );

  onSubmit("#booking-form", f =>
    api("/bookings", {
      method: "POST",
      body: JSON.stringify(f)
    })
  );

  onSubmit("#inspection-form", f =>
    api("/inspections", {
      method: "POST",
      body: JSON.stringify(f)
    })
  );

  // UPDATED: send service_cost along with labor and parts costs.
  onSubmit("#estimate-form", f =>
    api("/estimates", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        booking_id: Number(f.booking_id),
        labor_cost: Number(f.labor_cost),
        parts_cost: Number(f.parts_cost),
        service_cost: Number(f.service_cost)
      })
    })
  );

  onSubmit("#invoice-form", f =>
    api("/invoices", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        booking_id: Number(f.booking_id),
        tax_rate: Number(f.tax_rate)
      })
    })
  );

  onSubmit("#assignment-form", f =>
    api("/assignments", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        booking_id: Number(f.booking_id),
        mechanic_id: Number(f.mechanic_id)
      })
    })
  );

  onSubmit("#part-form", f =>
    api("/inventory", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        unit_price: Number(f.unit_price),
        stock_quantity: Number(f.stock_quantity),
        reorder_level: Number(f.reorder_level)
      })
    })
  );

  $$("[data-update-status]").forEach(b =>
    b.addEventListener("click", async () => {
      try {
        const id = b.dataset.updateStatus;
        const status = $(`[data-status-id="${id}"]`).value;

        await api(`/bookings/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status })
        });

        await loadAll();
        notify("Booking status updated.");
      } catch (e) {
        notify(e.message, "error");
      }
    })
  );

  $$("[data-estimate-decision]").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm(`${b.dataset.decision} this estimate?`)) return;

      try {
        await api(`/estimates/${b.dataset.estimateDecision}/decision`, {
          method: "PATCH",
          body: JSON.stringify({ decision: b.dataset.decision })
        });

        await loadAll();
        notify(`Estimate ${b.dataset.decision.toLowerCase()}.`);
      } catch (e) {
        notify(e.message, "error");
      }
    })
  );

  $$("[data-record-payment]").forEach(b =>
    b.addEventListener("click", async () => {
      const balance = prompt(
        `Enter payment amount in ₹ (invoice total ${b.dataset.total})`
      );

      if (balance === null) return;

      const method = prompt(
        "Payment method: Cash, Card, UPI, Bank Transfer, or Test Gateway",
        "UPI"
      ) || "UPI";

      try {
        await api("/payments", {
          method: "POST",
          body: JSON.stringify({
            invoice_id: Number(b.dataset.recordPayment),
            amount: Number(balance),
            method
          })
        });

        await loadAll();
        notify("Payment recorded.");
      } catch (e) {
        notify(e.message, "error");
      }
    })
  );

  $$("[data-edit-stock]").forEach(b =>
    b.addEventListener("click", async () => {
      const quantity = prompt(
        "Enter the new stock quantity",
        b.dataset.stock
      );

      if (quantity === null) return;

      try {
        await api(`/inventory/${b.dataset.editStock}`, {
          method: "PATCH",
          body: JSON.stringify({ stock_quantity: Number(quantity) })
        });

        await loadAll();
        notify("Stock updated.");
      } catch (e) {
        notify(e.message, "error");
      }
    })
  );

  $$("[data-save-role]").forEach(b =>
    b.addEventListener("click", async () => {
      const id = b.dataset.saveRole;
      const role = $(`[data-role-user="${id}"]`).value;

      if (!confirm(`Change this user's role to ${role}?`)) return;

      try {
        await api(`/admin/users/${id}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role })
        });

        await loadAll();
        notify("Role updated.");
      } catch (e) {
        notify(e.message, "error");
      }
    })
  );
}

(async function init() {
  if (!state.token) {
    showAuth();
    return;
  }

  try {
    await loadAll();
  } catch (e) {
    localStorage.removeItem("autocare_token");
    state.token = null;
    showAuth();
  }
})();