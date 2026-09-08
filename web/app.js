import { color, chartMarkup, wireChart } from "./chart.js";

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const state = {
  scenarios: [],
  scenario: null,
  result: null,
  errors: [],
  view: "overview",
  range: [0, null],
  hidden: new Set(),
  paymentFilter: "",
  search: "",
  from: "",
  to: "",
  page: 0,
  dayPage: 0,
  selectedDate: "",
  busy: false,
};
let requestVersion = 0,
  editorDirty = false;
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chart: "M3 3v18h18 M6 15l4-5 4 3 6-8",
  layers: "M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.1 M3 12h.1 M3 18h.1",
  settings:
    "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M6 6l2 2 M16 16l2 2 M6 18l2-2 M16 8l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  check: "M5 12l4 4L19 6",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  edit: "M15 4l5 5 M4 20l5-1L21 7l-4-4L5 15z",
  close: "M6 6l12 12 M6 18L18 6",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5",
  help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 6 M12 18h.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  chevron: "M9 5l7 7-7 7",
  warn: "M12 3L2 21h20z M12 9v5 M12 18h.1",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
  loan: "M3 8l9-5 9 5 M4 9h16 M6 10v8 M12 10v8 M18 10v8 M3 21h18",
  investment: "M3 17l6-6 4 3 8-10 M15 4h6v6 M3 21h18",
  income: "M12 3v14 M6 11l6 6 6-6 M4 21h16",
  expense: "M12 19V5 M6 11l6-6 6 6 M4 21h16",
  custom: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const btn = (label, action, style = "secondary", ico = "", extra = "") =>
  `<button type="button" class="btn ${style}" data-action="${action}" ${extra}>${ico ? icon(ico) : ""}${label}</button>`;
const rateNames = {
  nominal: "Yearly split evenly · nominal",
  effective: "Yearly true cost · effective",
  periodic: "Per payment period",
};
const frequencyNames = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
const typeNames = {
  loan: "Loan",
  investment: "Investment",
  income: "Income",
  expense: "Expense",
  custom: "Custom cashflows",
};
const digits = () => ({ JPY: 0, KWD: 3 })[state.scenario?.currency] ?? 2;
function amount(v, signed = false) {
  const raw = String(v ?? "0"),
    negative = raw.startsWith("-"),
    parts = raw.replace(/^[-+]/, "").split(".");
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits()
    ? "." + (parts[1] || "").padEnd(digits(), "0").slice(0, digits())
    : "";
  const symbol =
    {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      CAD: "C$",
      AUD: "A$",
      CHF: "CHF ",
      KWD: "KWD ",
    }[state.scenario?.currency] || "";
  const isZero = /^0*(\.0*)?$/.test(raw.replace("-", ""));
  return `${negative && !isZero ? "−" : signed && !isZero ? "+" : ""}${symbol}${whole}${fraction}`;
}
const positive = (v) => !String(v).startsWith("-");
function dateLabel(v) {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${Number(d)}, ${y}`;
}
function toast(text, error = false) {
  const el = $("#toast");
  el.textContent = text;
  el.className = error ? "show error" : "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ""), 6000);
}
async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Studio-Request": "local",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.message || "The action could not be completed.",
    );
    Object.assign(error, data);
    throw error;
  }
  return data;
}
async function safe(fn) {
  try {
    await fn();
  } catch (error) {
    toast(
      error.message ||
        "The local server is unavailable. Start Studio and try again.",
      true,
    );
  }
}
function replaceScenario(s) {
  state.scenario = s;
  const i = state.scenarios.findIndex((x) => x.id === s.id);
  if (i < 0) state.scenarios.unshift(s);
  else state.scenarios[i] = s;
}
async function calculate() {
  const token = ++requestVersion,
    scenario = state.scenario;
  state.result = null;
  state.errors = [];
  if (!scenario) return;
  try {
    const { result } = await api("/api/calculate", "POST", { scenario });
    if (token !== requestVersion) return;
    state.result = result;
    state.range = [0, null];
  } catch (error) {
    if (token !== requestVersion) return;
    state.errors = error.errors || [
      { path: "scenario", message: error.message },
    ];
  }
}
async function openScenario(id) {
  state.busy = true;
  render();
  try {
    const { scenario } = await api("/api/scenarios/" + id);
    replaceScenario(scenario);
    state.view = "overview";
    state.paymentFilter = "";
    state.page = 0;
    state.dayPage = 0;
    state.search = "";
    state.from = "";
    state.to = "";
    state.selectedDate = scenario.start;
    state.hidden = new Set();
    await calculate();
    location.hash = id;
  } finally {
    state.busy = false;
    render();
  }
}
async function saveScenario(doc) {
  const { scenario } = await api("/api/scenarios/" + state.scenario.id, "PUT", {
    scenario: doc,
    revision: state.scenario.revision,
  });
  replaceScenario(scenario);
  await calculate();
  render();
  toast(
    state.errors.length
      ? "Draft saved. Review the inputs before calculating."
      : "Saved on this computer. Results recalculated.",
  );
}
async function newScenario(template) {
  const { scenario } = await api(
    "/api/scenarios",
    "POST",
    template ? { template } : {},
  );
  state.scenarios.unshift(scenario);
  await openScenario(scenario.id);
  if (!template) editScenario();
}

function sidebar() {
  return `<aside class="sidebar"><button class="brand" data-action="library"><span class="brand-mark">F<span></span></span><span>Forecasting<span class="brand-sub">STUDIO</span></span></button><div class="sidebar-section">YOUR WORKSPACE</div><button class="side-nav ${!state.scenario ? "active" : ""}" data-action="library">${icon("grid")}Scenario library<span class="count">${state.scenarios.length}</span></button><div class="sidebar-section sidebar-label">SCENARIOS<button class="icon-button" aria-label="Create a scenario" data-action="new">${icon("plus")}</button></div><div class="scenario-nav">${state.scenarios.length ? state.scenarios.map((s) => `<button class="scenario-link ${state.scenario?.id === s.id ? "active" : ""}" data-open="${esc(s.id)}"><span class="scenario-dot ${s.confirmed ? "confirmed" : ""}"></span><span>${esc(s.name || "Untitled scenario")}</span></button>`).join("") : '<p class="side-empty">Your saved scenarios will appear here.</p>'}</div><div class="sidebar-bottom"><button class="side-nav" data-action="guide">${icon("help")}How the studio works</button><div class="local-note">${icon("shield")}<span>Private by design<small>Stored only on this computer</small></span></div></div></aside>`;
}
function shell(content) {
  return `${sidebar()}<div class="workspace"><header class="topbar"><div class="breadcrumbs">Workspace ${icon("chevron")} <span>${state.scenario ? "Scenario studio" : "Scenario library"}</span></div><button class="text-button compact-guide" data-action="guide">${icon("help")}Guide</button><span class="local-status"><i></i>Local workspace</span></header><main id="main" tabindex="-1">${content}</main><footer>Financial Forecasting Studio <span>All amounts are manually entered · No external connections</span></footer></div>`;
}
function library() {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR FINANCIAL PLANS</div><h1>Scenario library</h1><p>A clear view of when money moves, and what your plan is worth.</p></div>${btn("New scenario", "new", "primary", "plus")}</div><div class="library-toolbar"><span>${state.scenarios.length} saved scenario${state.scenarios.length === 1 ? "" : "s"}</span><div>${btn("Import backup", "import", "text", "upload")}${btn("Export backup", "backup", "text", "download")}</div></div>${state.scenarios.length ? `<div class="scenario-grid">${state.scenarios.map((s) => `<article class="scenario-card"><div class="card-top"><span class="object-icon">${icon("layers")}</span><span class="badge ${s.confirmed ? "success" : "neutral"}">${s.confirmed ? "Confirmed" : "Draft"}</span></div><h2>${esc(s.name || "Untitled scenario")}</h2><p>${dateLabel(s.start)} — ${dateLabel(s.end)}</p><div class="scenario-card-meta"><span>${s.objects.length} financial objects</span><span>${esc(s.currency)}</span></div><button class="card-open" data-open="${esc(s.id)}">Open scenario ${icon("arrow")}</button></article>`).join("")}</div>` : `<section class="welcome panel"><span class="welcome-icon">${icon("chart")}</span><h2>Give your financial plan a timeline.</h2><p>Combine a loan, an investment, everyday income and expenses. See whether cash lasts through every payment.</p><div class="actions">${btn("Create your first scenario", "new", "primary", "plus")}${btn("Explore an example", "demo", "secondary", "arrow")}</div><div class="welcome-steps"><span><b>01</b>Set your assumptions</span><span><b>02</b>Add your financial objects</span><span><b>03</b>See the complete picture</span></div></section>`}<section class="library-note"><div>${icon("shield")}<div><h3>Your plans stay with you.</h3><p>Scenarios are saved in a local database. Export a backup to keep a separate copy.</p></div></div>${state.scenarios.length ? btn("Add illustrative scenario", "demo", "text", "plus") : ""}</section>`;
}
function header() {
  const s = state.scenario;
  return `<div class="page-heading scenario-heading"><div><div class="eyebrow">SCENARIO STUDIO <span class="badge ${s.confirmed ? "success" : "neutral"}">${s.confirmed ? "Confirmed" : "Draft · review needed"}</span></div><h1>${esc(s.name || "Untitled scenario")}</h1><div class="scenario-meta"><span>${icon("calendar")}${dateLabel(s.start)} — ${dateLabel(s.end)}</span><span>${esc(s.currency)}</span><span>${s.objects.length} objects</span></div></div><div class="heading-actions">${btn("Edit assumptions", "edit-scenario", "secondary", "settings")}${btn("Review & confirm", "review", "primary", "check")}</div></div><nav class="tabs" aria-label="Scenario views">${[
    ["overview", "chart", "Overview"],
    ["objects", "layers", "Financial objects"],
    ["payments", "list", "Payments"],
    ["balance", "calendar", "Daily balance"],
    ["assumptions", "settings", "Assumptions"],
  ]
    .map(
      ([v, i, label]) =>
        `<button class="tab ${state.view === v ? "active" : ""}" data-view="${v}" ${state.view === v ? 'aria-current="page"' : ""}>${icon(i)}${label}${v === "objects" ? `<span class="tab-count">${s.objects.length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}<span class="saved-label">${icon("check")}Saved locally · revision ${s.revision}</span></nav>`;
}
function validationPanel() {
  return `<section class="validation panel" role="alert"><div class="section-heading"><div><h2>${state.errors.length} input${state.errors.length === 1 ? "" : "s"} to review</h2><p>Your draft is saved. Calculations are withheld until the complete plan is valid.</p></div></div>${state.errors.map((e) => `<button class="validation-item" data-fix="${esc(e.path)}">${icon("warn")}<span><strong>${esc(errorLabel(e.path))}</strong>${esc(e.message)}</span>${icon("chevron")}</button>`).join("")}</section>`;
}
function errorLabel(path) {
  const parts = path.split(".");
  const names = {
    amount: "Amount",
    date: "Date",
    payments: "Number of repayments",
    rateBasis: "Rate basis",
    rate: "Interest rate",
    firstPayment: "First payment",
    end: "End date",
    start: "Start date",
    principal: "Principal received",
    payment: "Regular payment",
    growthRate: "Growth rate",
    name: "Name",
    rows: "Cashflow rows",
    frequency: "Frequency",
    payout: "Payout behavior",
  };
  if (parts[0] === "objects" && parts[1])
    return `${state.scenario.objects[Number(parts[1])]?.name || "Financial object"}${parts[2] === "rows" && parts[3] !== undefined ? ` · row ${Number(parts[3]) + 1}` : ""} · ${names[parts.at(-1)] || "Assumptions"}`;
  return (
    {
      openingCash: "Opening cash",
      discountRate: "Discount rate",
      start: "Scenario start",
      end: "Scenario end",
      name: "Scenario name",
      currency: "Currency",
    }[path] || "Scenario"
  );
}
function metrics() {
  const r = state.result.summary,
    s = state.scenario;
  return `<div class="metric-grid"><article class="metric"><div class="metric-label">Cash feasibility ${icon("shield")}</div><div class="metric-value ${r.feasible ? "green" : "red"}">${r.feasible ? "Cash-feasible" : "Cash shortfall"}</div><p>${r.feasible ? "Closing cash stays at or above zero." : `First shortfall on ${dateLabel(r.firstShortfall.date)}`}</p><span class="metric-foot ${r.feasible ? "green" : "red"}">${r.feasible ? (state.result.warnings.length ? "Payment-order warnings to review" : "All daily closing balances covered") : `${amount(r.firstShortfall.amount)} needed that day`}</span></article><article class="metric"><div class="metric-label">Net present value ${icon("investment")}</div><div class="metric-value ${positive(r.npv) ? "" : "red"}" title="${esc(amount(r.npv, true))}">${amount(r.npv, true)}</div><p>Plan value at a ${esc(s.discountRate)}% annual hurdle rate.</p><span class="metric-foot">Opening cash excluded</span></article><article class="metric"><div class="metric-label">Ending cash ${icon("income")}</div><div class="metric-value" title="${esc(amount(r.endingCash))}">${amount(r.endingCash)}</div><p>Available on ${dateLabel(s.end)}</p><span class="metric-foot">Opening cash ${amount(s.openingCash)}</span></article><article class="metric"><div class="metric-label">Lowest closing cash ${icon("chart")}</div><div class="metric-value ${positive(r.lowest.balance) ? "" : "red"}" title="${esc(amount(r.lowest.balance))}">${amount(r.lowest.balance)}</div><p>First occurs on ${dateLabel(r.lowest.date)}</p><button class="metric-link" data-inspect="${r.lowest.date}">Inspect this date ${icon("arrow")}</button></article></div>`;
}
function conclusion() {
  const r = state.result.summary;
  const zero = /^-?0(?:\.0*)?$/.test(r.npv);
  return `<div class="conclusion ${r.feasible ? "" : "is-shortfall"}">${icon(r.feasible ? "check" : "warn")}<div><strong>${r.feasible ? "Your plan covers every end-of-day cash requirement." : `Cash first runs short on ${dateLabel(r.firstShortfall.date)}.`}</strong><p>${r.feasible ? "" : `The closing balance is ${amount(r.firstShortfall.balance)}, leaving a ${amount(r.firstShortfall.amount)} gap. Payments from ${esc(r.firstShortfall.causes.join(", "))} contribute to that day’s shortfall. `}${zero ? "The plan meets your hurdle rate to the displayed currency precision." : positive(r.npv) ? "Discounted inflows exceed discounted outflows at your chosen hurdle rate." : "Discounted outflows exceed discounted inflows at your chosen hurdle rate."}${state.result.warnings.length ? " Same-day payment order still needs attention." : ""}</p></div></div>`;
}
function overview() {
  if (!state.result) return validationPanel();
  return `${!state.scenario.confirmed ? '<div class="draft-banner">These are recalculated draft results. Review all inputs and warnings before confirming the plan.</div>' : ""}${metrics()}${conclusion()}<section class="panel chart-panel"><div class="section-heading"><div><div class="eyebrow">THE COMPLETE CASH STORY</div><h2>Cash through time</h2><p>See the timing behind your financial plan.</p></div><div class="chart-controls">${btn("←", "pan-left", "small", "", 'aria-label="Pan earlier"')}${btn("Zoom in", "zoom-in", "small")}${btn("Zoom out", "zoom-out", "small")}${btn("→", "pan-right", "small", "", 'aria-label="Pan later"')}${btn("Full horizon", "reset-range", "text small")}</div></div><div class="range-fields"><label>From <input type="date" id="chart-from" value="${state.result.daily[state.range[0]]?.date || state.scenario.start}" min="${state.scenario.start}" max="${state.scenario.end}"></label><label>To <input type="date" id="chart-to" value="${state.result.daily[state.range[1] ?? state.result.daily.length - 1]?.date || state.scenario.end}" min="${state.scenario.start}" max="${state.scenario.end}"></label><label class="range-slider">Move through time <input type="range" id="chart-pan" aria-label="Pan timeline" min="0" max="${Math.max(0, state.result.daily.length - 1 - ((state.range[1] ?? state.result.daily.length - 1) - state.range[0]))}" value="${state.range[0]}"></label></div><div id="chart-region">${chartMarkup(state.result, state.scenario, state.range, state.hidden, esc, amount)}<div class="chart-tooltip" hidden></div></div></section><div class="overview-bottom"><section class="panel"><div class="section-heading"><div><h2>Object contributions</h2><p>Every part of the plan, in today’s money.</p></div><button class="text-button" data-view="objects">Manage objects ${icon("arrow")}</button></div>${state.result.objects.length ? state.result.objects.map((o, i) => `<button class="contribution" data-schedule="${esc(o.id)}"><span class="object-number" style="--object-color:${color(i)}">${String(i + 1).padStart(2, "0")}</span><span><strong>${esc(o.name)}</strong><small>${typeNames[o.type]} · ${o.count} cashflows</small></span><span class="contribution-value ${positive(o.npv) ? "" : "red"}">${amount(o.npv, true)}<small>present value</small></span>${icon("chevron")}</button>`).join("") : '<div class="small-empty">No financial objects yet. Add one to start modeling your plan.</div>'}<p class="micro">Contributions are rounded individually. Their displayed sum may differ slightly from the total NPV, which is rounded once.</p></section><section class="panel"><div class="section-heading"><div><h2>Things to know</h2><p>Assumptions that shape your result.</p></div>${icon("help")}</div>${warningsMarkup(3)}<div class="info-note"><strong>Liquidity and value answer different questions.</strong><p>Opening cash helps you meet payments. It does not increase the value created by the modeled plan.</p></div><button class="text-button" data-view="assumptions">Explore all assumptions ${icon("arrow")}</button></section></div>`;
}
function warningsMarkup(limit = Infinity) {
  const w = state.result?.warnings || [];
  return w.length
    ? `<div class="warning-list">${w
        .slice(0, limit)
        .map(
          (d) =>
            `<div class="warning-item">${icon("warn")}<div><strong>Payment order · ${dateLabel(d.date)}</strong><p>Opening cash ${amount(d.opening)}, inflows ${amount(d.inflows)}, outflows ${amount(d.outflows)}. Paying out first leaves a ${amount(d.gap)} gap, although closing cash is ${amount(d.balance)}.</p><button class="text-button" data-inspect="${d.date}">Inspect ${esc(d.objects.join(", "))}</button></div></div>`,
        )
        .join(
          "",
        )}${w.length > limit ? `<button class="text-button" data-view="assumptions">See all ${w.length} warnings ${icon("arrow")}</button>` : ""}</div>`
    : '<div class="no-warnings">' +
        icon("check") +
        "No same-day payment-order warnings.</div>";
}
function objectsView() {
  const s = state.scenario;
  return `<div class="section-heading view-heading"><div><h2>Your financial objects</h2><p>Money received is positive. Money paid is negative.</p></div>${btn("Add financial object", "add-object", "primary", "plus")}</div>${
    !s.objects.length
      ? `<section class="panel small-empty"><span class="welcome-icon">${icon("layers")}</span><h2>Start with one part of your plan.</h2><p>Add a loan, an investment, recurring income or expenses, or your own dated cashflows.</p>${objectChoices()}</section>`
      : `<div class="object-grid">${s.objects
          .map((o, i) => {
            const result = state.result?.objects.find((r) => r.id === o.id);
            const errors = state.errors.filter(
              (e) =>
                e.path.startsWith(`objects.${i}.`) || e.path === `objects.${i}`,
            );
            return `<article class="object-card panel"><div class="card-top"><div class="object-card-type"><span class="object-icon" style="--object-color:${color(i)}">${icon(o.type)}</span><span class="eyebrow">${typeNames[o.type]}</span></div><span class="object-number" style="--object-color:${color(i)}">${String(i + 1).padStart(2, "0")}</span></div><h2>${esc(o.name || "Unnamed object")}</h2><p class="object-description">${objectDescription(o)}</p><dl class="object-stats"><div><dt>${o.type === "loan" ? (o.method === "principal" ? "Principal received" : "Regular payment") : o.type === "investment" ? "Amount invested" : o.type === "custom" ? "Net cashflow" : "Starting payment"}</dt><dd>${o.type === "custom" ? (result ? amount(result.net, true) : "Review needed") : amount(o[o.type === "loan" ? o.method : "amount"])}</dd></div><div><dt>${o.type === "loan" || o.type === "investment" ? "Entered rate" : o.type === "custom" ? "Dated rows" : "Frequency"}</dt><dd>${o.type === "loan" || o.type === "investment" ? esc(o.rate) + "%" : o.type === "custom" ? o.rows.length : frequencyNames[o.frequency]}</dd></div></dl>${errors.length ? `<p class="inline-error">${icon("warn")}${errors.length} input${errors.length === 1 ? "" : "s"} to review</p>` : ""}${o.copiedFrom ? '<p class="copy-notice">Schedule copy · original and copy both count.</p>' : ""}<div class="object-card-actions"><button class="text-button" data-edit="${esc(o.id)}">${icon("edit")}Edit</button><button class="text-button" data-schedule="${esc(o.id)}" ${result ? "" : "disabled"}>View schedule ${icon("arrow")}</button><div class="object-more"><button class="icon-button" data-duplicate-object="${esc(o.id)}" aria-label="Duplicate ${esc(o.name)}" title="Duplicate object">${icon("copy")}</button><button class="icon-button danger-text" data-delete-object="${esc(o.id)}" aria-label="Delete ${esc(o.name)}" title="Delete object">${icon("trash")}</button></div></div>${result && o.type !== "custom" ? `<button class="copy-custom" data-copy-custom="${esc(o.id)}">Copy generated schedule as custom ${icon("arrow")}</button>` : ""}</article>`;
          })
          .join("")}</div>`
  }`;
}
function objectDescription(o) {
  if (o.type === "custom") return "Your own signed amounts and dates.";
  if (o.type === "loan")
    return `${o.payments} ${frequencyNames[o.frequency]?.toLowerCase() || ""} repayments · ${esc(rateNames[o.rateBasis] || "Select rate basis")}`;
  if (o.type === "investment")
    return `${o.payout === "maturity" ? "Capital and interest at maturity" : "Interest paid each period"} · ${dateLabel(o.end)}`;
  return `${o.growthMode === "annual" ? "Annual anniversary growth" : o.growthMode === "payment" ? "Growth every payment" : "Fixed payments"}${o.growthMode !== "none" ? ` · ${esc(o.growthRate)}%` : ""}`;
}
function reviewInputs(o) {
  if (o.type === "custom")
    return `<details class="review-inputs"><summary>Review all ${o.rows.length} custom rows</summary><div class="table-scroll"><table><thead><tr><th>Date</th><th class="numeric">Signed amount</th><th>Note</th></tr></thead><tbody>${o.rows.map((r) => `<tr><td>${dateLabel(r.date)}</td><td class="numeric">${amount(r.amount, true)}</td><td>${esc(r.note || "Custom cashflow")}</td></tr>`).join("")}</tbody></table></div></details>`;
  const pairs = [
    [
      o.type === "loan"
        ? o.method === "principal"
          ? "Principal received"
          : "Known regular repayment"
        : o.type === "investment"
          ? "Amount invested"
          : "Starting payment",
      amount(o[o.type === "loan" ? o.method : "amount"]),
    ],
    ["Start date", dateLabel(o.start)],
    ["Frequency", frequencyNames[o.frequency]],
  ];
  if (o.end) pairs.push(["Maturity / final included date", dateLabel(o.end)]);
  if (o.type !== "investment")
    pairs.push([
      "First payment",
      o.firstPayment
        ? dateLabel(o.firstPayment)
        : "One full period after start",
    ]);
  if (o.type === "loan")
    pairs.push(
      ["Number of repayments", o.payments],
      [
        "Loan method",
        o.method === "principal" ? "Known principal" : "Known payment",
      ],
    );
  if (o.rate !== undefined)
    pairs.push(
      ["Entered interest rate", o.rate + "%"],
      ["Rate meaning", rateNames[o.rateBasis]],
    );
  if (o.type === "investment")
    pairs.push([
      "Payout",
      o.payout === "maturity"
        ? "Capital and compounded interest at maturity"
        : "Interest each full period; principal at maturity",
    ]);
  if (o.growthMode)
    pairs.push(
      [
        "Growth mechanism",
        {
          none: "Fixed",
          annual: "Annual anniversaries of first payment",
          payment: "Every payment after the first",
        }[o.growthMode],
      ],
      ["Growth rate", o.growthRate + "%"],
    );
  return `<details class="review-inputs"><summary>Review every input</summary><dl class="assumption-list">${pairs.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl></details>`;
}
function objectChoices() {
  return `<div class="object-choices">${Object.entries(typeNames)
    .map(
      ([key, name]) =>
        `<button data-add-type="${key}" class="object-choice"><span class="object-icon">${icon(key)}</span><strong>${name}</strong><small>${{ loan: "Receive now, repay over time", investment: "Deposit now, receive a return", income: "Recurring money received", expense: "Recurring money paid", custom: "Any signed, dated payments" }[key]}</small>${icon("plus")}</button>`,
    )
    .join("")}</div>`;
}

function paymentsView() {
  if (!state.result) return validationPanel();
  const all = state.result.flows;
  const filtered = all.filter(
    (f) =>
      (!state.paymentFilter || f.objectId === state.paymentFilter) &&
      (!state.from || f.date >= state.from) &&
      (!state.to || f.date <= state.to) &&
      (!state.search ||
        `${f.objectName} ${f.rule}`
          .toLowerCase()
          .includes(state.search.toLowerCase())),
  );
  const page = Math.min(
    state.page,
    Math.max(0, Math.ceil(filtered.length / 50) - 1),
  );
  state.page = page;
  const rows = filtered.slice(page * 50, (page + 1) * 50);
  const obj = state.result.objects.find((o) => o.id === state.paymentFilter);
  return `<div class="section-heading view-heading"><div><h2>${obj ? esc(obj.name) + " · schedule" : "Every dated payment"}</h2><p>Each row is one cashflow. Same-day closing cash includes all objects.</p></div>${btn("Export payments CSV", "export-payments", "secondary", "download")}</div>${obj ? `<section class="schedule-summary panel"><div><span class="eyebrow">${typeNames[obj.type]} · ${obj.count} cashflows</span><h3>Net cashflow ${amount(obj.net, true)} <span>· NPV ${amount(obj.npv, true)}</span></h3></div><div>${obj.details.regularPayment ? `<p>Principal ${amount(obj.details.principal)} · Regular payment ${amount(obj.details.regularPayment)} · Final payment ${amount(obj.details.finalPayment)}</p><p>Total interest ${amount(obj.details.totalInterest)} · Final obligation ${amount(obj.details.finalBalance)} · Final adjustment ${amount(obj.details.finalAdjustment, true)}</p>` : ""}${obj.details.periodicRatePercent ? `<p>Calculated periodic rate: ${esc(obj.details.periodicRatePercent)}%</p>` : ""}${obj.details.fullPeriods !== undefined ? `<p>${obj.details.fullPeriods} complete period(s) · ${obj.details.partialDays} partial interest day(s) · Partial interest ${amount(obj.details.partialInterest)}</p>` : ""}${obj.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>${obj.type !== "custom" ? `<button class="btn secondary" data-copy-custom="${esc(obj.id)}">${icon("copy")}Copy as custom</button>` : ""}</section>` : ""}<section class="panel table-panel"><div class="table-filters"><label>Financial object<select id="payment-object"><option value="">All objects</option>${state.scenario.objects.map((o) => `<option value="${esc(o.id)}" ${state.paymentFilter === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label><label>Search payments<input id="payment-search" type="search" value="${esc(state.search)}" placeholder="Name or schedule rule"></label><label>From<input id="payment-from" type="date" value="${state.from}"></label><label>To<input id="payment-to" type="date" value="${state.to}"></label>${btn("Clear", "clear-filters", "text")}</div><div class="table-scroll"><table><thead><tr><th>Date</th><th>Financial object / schedule rule</th><th class="numeric">Signed cashflow</th>${obj?.type === "loan" ? '<th class="numeric">Interest</th><th class="numeric">Principal repaid</th><th class="numeric">Obligation left</th>' : ""}<th class="numeric">Present value</th><th class="numeric">Day’s closing cash</th></tr></thead><tbody>${rows.length ? rows.map((f) => `<tr><td><button class="date-button" data-inspect="${f.date}">${dateLabel(f.date)}</button></td><td><div class="table-object"><span class="object-number" style="--object-color:${color(state.scenario.objects.findIndex((o) => o.id === f.objectId))}">${String(state.scenario.objects.findIndex((o) => o.id === f.objectId) + 1).padStart(2, "0")}</span><span><strong>${esc(f.objectName)}</strong><small>${esc(f.rule)}</small></span></div></td><td class="numeric ${positive(f.amount) ? "green" : "red"}">${amount(f.amount, true)}</td>${obj?.type === "loan" ? `<td class="numeric">${f.interest !== undefined ? amount(f.interest) : "—"}</td><td class="numeric">${f.principal !== undefined ? amount(f.principal) : "—"}</td><td class="numeric">${amount(f.remaining)}</td>` : ""}<td class="numeric" title="${f.discountDays} interest days from the valuation date">${amount(f.presentValue, true)}</td><td class="numeric ${positive(f.closingBalance) ? "" : "red"}">${amount(f.closingBalance)}</td></tr>`).join("") : '<tr><td colspan="8" class="empty-cell">No payments match these filters.</td></tr>'}</tbody></table></div>${pagination(page, filtered.length, "payment")}</section><p class="micro">Present values use ${esc(state.scenario.discountRate)}% annually and 30E/360 from ${dateLabel(state.scenario.start)}. Individual present values are rounded for display; NPV is rounded after summation. Table row order does not imply an order of settlement.</p>`;
}
function pagination(page, total, kind) {
  return `<div class="pagination"><span>${total ? `${page * 50 + 1}–${Math.min(total, (page + 1) * 50)} of ${total.toLocaleString()}` : "0"} rows</span><div><button class="btn small" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 0 ? "disabled" : ""}>Previous</button><span>Page ${page + 1} of ${Math.max(1, Math.ceil(total / 50))}</span><button class="btn small" data-page-kind="${kind}" data-page="${page + 1}" ${(page + 1) * 50 >= total ? "disabled" : ""}>Next</button></div></div>`;
}
function dayInspector(date) {
  const d =
    state.result.daily.find((row) => row.date === date) ||
    state.result.daily[0];
  const flows = state.result.flows.filter((f) => f.date === d.date);
  return `<section class="panel date-inspector"><div class="section-heading"><div><div class="eyebrow">DATE INSPECTOR</div><h2>${dateLabel(d.date)}</h2></div><label class="sr-only" for="inspect-date">Inspect a calendar date</label><input id="inspect-date" type="date" min="${state.scenario.start}" max="${state.scenario.end}" value="${d.date}"></div><div class="day-equation"><span><small>Opening cash</small><strong>${amount(d.opening)}</strong></span><b>+</b><span><small>Money received</small><strong class="green">${amount(d.inflows)}</strong></span><b>+</b><span><small>Money paid</small><strong class="red">${amount(d.outflows)}</strong></span><b>=</b><span><small>Closing cash</small><strong class="${positive(d.balance) ? "" : "red"}">${amount(d.balance)}</strong></span></div>${flows.length ? `<div class="inspector-flows">${flows.map((f) => `<button class="inspector-flow" data-schedule="${esc(f.objectId)}"><span>${esc(f.objectName)}<small>${esc(f.rule)}</small></span><strong class="${positive(f.amount) ? "green" : "red"}">${amount(f.amount, true)}</strong>${icon("chevron")}</button>`).join("")}</div>` : '<p class="no-movement">No cash moves on this date. The previous balance carries forward.</p>'}${state.result.warnings.some((w) => w.date === d.date) ? '<p class="inline-warning">' + icon("warn") + "This date depends on payment order. Outflows paid before inflows would temporarily exceed the available cash.</p>" : ""}</section>`;
}
function balanceView() {
  if (!state.result) return validationPanel();
  const r = state.result;
  const rows = r.daily.slice(state.dayPage * 50, (state.dayPage + 1) * 50);
  return `<div class="section-heading view-heading"><div><h2>Cash on every calendar day</h2><p>Actual dates, including days with no payments. No overdraft is assumed.</p></div>${btn("Export daily balances CSV", "export-balance", "secondary", "download")}</div>${dayInspector(state.selectedDate || state.scenario.start)}<section class="panel table-panel"><div class="section-heading"><h3>Complete daily balance timeline</h3><button class="text-button" data-action="jump-lowest">Jump to lowest balance ${icon("arrow")}</button></div><div class="table-scroll"><table><thead><tr><th>Date</th><th class="numeric">Opening cash</th><th class="numeric">Received</th><th class="numeric">Paid</th><th class="numeric">Net movement</th><th class="numeric">Closing cash</th></tr></thead><tbody>${rows.map((d) => `<tr class="${!positive(d.balance) ? "negative-row" : ""}"><td><button class="date-button" data-inspect="${d.date}">${dateLabel(d.date)}</button></td><td class="numeric">${amount(d.opening)}</td><td class="numeric green">${amount(d.inflows, true)}</td><td class="numeric red">${amount(d.outflows, true)}</td><td class="numeric">${amount(d.net, true)}</td><td class="numeric"><strong>${amount(d.balance)}</strong></td></tr>`).join("")}</tbody></table></div>${pagination(state.dayPage, r.daily.length, "day")}</section>`;
}
function assumptionsView() {
  const s = state.scenario;
  return `<div class="section-heading view-heading"><div><h2>The assumptions behind your plan</h2><p>All rates and amounts are entered by you. Nothing is fetched or inferred from market data.</p></div>${btn("Edit assumptions", "edit-scenario", "secondary", "edit")}</div><div class="assumption-columns"><section class="panel"><h3>Scenario environment</h3><dl class="assumption-list"><div><dt>Valuation and simulation start</dt><dd>${dateLabel(s.start)}</dd></div><div><dt>Simulation end · inclusive</dt><dd>${dateLabel(s.end)}</dd></div><div><dt>Opening cash · excluded from NPV</dt><dd>${amount(s.openingCash)}</dd></div><div><dt>Annual effective discount rate</dt><dd>${esc(s.discountRate)}%</dd></div><div><dt>Currency and minor unit</dt><dd>${esc(s.currency)} · ${digits()} decimal places</dd></div><div><dt>Calculation engine</dt><dd>1.0.0 · deterministic</dd></div></dl></section><section class="panel"><h3>Financial conventions</h3><div class="prose"><p><strong>30E/360.</strong> Both day numbers of 31 become 30. February keeps its actual day number. This convention values dated cashflows and prorates incomplete periods.</p><p><strong>Calendar anniversaries.</strong> A missing day falls on the month’s final day, then returns to the original anchor when possible. Dates are not moved for weekends or holidays.</p><p><strong>Money rounding.</strong> Round to the currency’s minor unit, with exact halves away from zero. Round each posted payment; clear a loan’s remaining obligation in its final payment.</p><p><strong>No automatic additions.</strong> Include taxes, fees, inflation-related growth, and other commitments explicitly. No credit line, asset sale, or interest on idle cash is assumed.</p></div></section></div><section class="panel assumptions-objects"><h3>Object assumptions</h3>${s.objects.length ? s.objects.map((o, i) => `<div class="assumption-object"><div><span class="object-number" style="--object-color:${color(i)}">${String(i + 1).padStart(2, "0")}</span><strong>${esc(o.name)}</strong><button class="text-button" data-edit="${esc(o.id)}">Edit</button></div><p>${objectDescription(o)}</p>${reviewInputs(o)}<p>${o.type === "custom" ? `${o.rows.length} individually dated signed cashflows.` : `Starts ${dateLabel(o.start)}${o.end ? ` · Ends ${dateLabel(o.end)}` : ""} · ${frequencyNames[o.frequency]}${o.rateBasis ? ` · ${esc(rateNames[o.rateBasis])} at ${esc(o.rate)}%` : ""}${o.firstPayment ? ` · First payment ${dateLabel(o.firstPayment)}` : o.type !== "investment" ? " · First payment one full period after start" : ""}`}</p>${o.type === "income" || o.type === "expense" ? "<p>Growth starts from the first payment. Annual changes occur on its calendar anniversaries; every-payment growth begins with the second payment.</p>" : ""}${(state.result?.objects.find((x) => x.id === o.id)?.notes || []).map((n) => `<p class="assumption-notice">${esc(n)}</p>`).join("")}</div>`).join("") : '<p class="muted">No financial objects added yet.</p>'}</section><section class="panel"><div class="section-heading"><div><h3>Same-day payment-order warnings</h3><p>${s.warningsAccepted ? "Accepted for this saved revision. These warnings remain part of the result." : "Review these warnings before confirming the scenario."}</p></div></div>${state.result ? warningsMarkup() : validationPanel()}</section><div class="scenario-management"><span>Explore an alternative with an independent copy.</span>${btn("Duplicate scenario", "duplicate", "secondary", "copy")}${btn("Delete scenario", "delete-scenario", "danger", "trash")}</div>`;
}

function render() {
  const content = state.busy
    ? '<div class="initial-load">Loading your saved scenario…</div>'
    : state.scenario
      ? header() +
        {
          overview: overview,
          objects: objectsView,
          payments: paymentsView,
          balance: balanceView,
          assumptions: assumptionsView,
        }[state.view]()
      : library();
  $("#app").innerHTML = shell(content);
  wire();
  if (state.view === "overview" && state.result && $("#chart-region"))
    wireChart(
      $("#chart-region"),
      state.result,
      state.range,
      amount,
      inspect,
      toggleLegend,
      esc,
    );
  document.title = state.scenario
    ? `${state.scenario.name} · Forecasting Studio`
    : "Financial Forecasting Studio";
}
function goView(view) {
  state.view = view;
  render();
  $("#main").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
function inspect(date) {
  state.selectedDate = date;
  state.view = "balance";
  state.dayPage = Math.floor(
    Math.max(
      0,
      state.result.daily.findIndex((d) => d.date === date),
    ) / 50,
  );
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function schedule(id) {
  state.paymentFilter = id;
  state.page = 0;
  state.search = "";
  state.from = "";
  state.to = "";
  goView("payments");
}
function toggleLegend(id) {
  state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
  const pos = window.scrollY;
  render();
  window.scrollTo(0, pos);
}
function adjustRange(kind) {
  const max = state.result.daily.length - 1;
  let [lo, hi] = [state.range[0], state.range[1] ?? max],
    width = hi - lo;
  const center = (lo + hi) / 2;
  if (kind === "reset-range") {
    lo = 0;
    hi = max;
  } else if (kind.startsWith("pan")) {
    const step =
      Math.max(1, Math.round(width / 3)) * (kind === "pan-left" ? -1 : 1);
    lo = Math.min(Math.max(0, lo + step), max - width);
    hi = lo + width;
  } else {
    width = Math.min(
      max,
      Math.max(7, Math.round(width * (kind === "zoom-in" ? 0.5 : 2))),
    );
    lo = Math.max(0, Math.round(center - width / 2));
    hi = Math.min(max, lo + width);
    lo = Math.max(0, hi - width);
  }
  state.range = [lo, hi];
  const pos = window.scrollY;
  render();
  window.scrollTo(0, pos);
}

function showDialog(title, body, wide = false) {
  const d = $("#editor");
  editorDirty = false;
  d.className = wide ? "wide" : "";
  d.innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">FORECASTING STUDIO</div><h2 id="dialog-title">${title}</h2></div><button class="icon-button" id="close-dialog" aria-label="Close dialog">${icon("close")}</button></div>${body}`;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  $("#close-dialog").onclick = closeDialog;
  d.oncancel = (e) => {
    e.preventDefault();
    closeDialog();
  };
  d.querySelectorAll("input,select,textarea").forEach((el) =>
    el.addEventListener("input", () => (editorDirty = true)),
  );
  d.querySelectorAll('[data-action="cancel-dialog"]').forEach(
    (el) => (el.onclick = closeDialog),
  );
  wireDialog();
}
function closeDialog() {
  if (editorDirty) {
    const notice = $("#editor").querySelector("#discard-notice");
    if (notice) {
      notice.focus();
      return;
    }
    const box = document.createElement("div");
    box.className = "discard-notice";
    box.id = "discard-notice";
    box.tabIndex = -1;
    box.innerHTML =
      '<p>You have unsaved form changes.</p><button class="btn danger" id="discard-form">Discard changes</button> <button class="btn secondary" id="keep-form">Keep editing</button>';
    $("#editor").append(box);
    $("#discard-form").onclick = () => {
      $("#editor").close();
      editorDirty = false;
    };
    $("#keep-form").onclick = () => box.remove();
    box.focus();
    return;
  }
  $("#editor").close();
}
function wireDialog() {
  const d = $("#editor");
  d.querySelectorAll("[data-add-type]").forEach(
    (el) => (el.onclick = () => editObject(null, el.dataset.addType)),
  );
  d.querySelectorAll("[data-edit]").forEach(
    (el) => (el.onclick = () => editObject(el.dataset.edit)),
  );
  d.querySelectorAll("[data-fix]").forEach(
    (el) => (el.onclick = () => fix(el.dataset.fix)),
  );
  d.querySelectorAll("[data-inspect]").forEach(
    (el) =>
      (el.onclick = () => {
        editorDirty = false;
        d.close();
        inspect(el.dataset.inspect);
      }),
  );
  d.querySelectorAll("[data-view]").forEach(
    (el) =>
      (el.onclick = () => {
        editorDirty = false;
        d.close();
        goView(el.dataset.view);
      }),
  );
}
function inputField(name, label, value, type = "text", help = "", attrs = "") {
  return `<label class="field" for="f-${name}"><span>${label}</span><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${help ? `<small>${help}</small>` : ""}<span class="field-error" data-field-error="${name}"></span></label>`;
}
function selectField(name, label, value, options, help = "") {
  return `<label class="field" for="f-${name}"><span>${label}</span><select id="f-${name}" name="${name}">${Object.entries(
    options,
  )
    .map(
      ([v, l]) =>
        `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select>${help ? `<small>${help}</small>` : ""}<span class="field-error" data-field-error="${name}"></span></label>`;
}
const dateField = (name, label, value, help = "") =>
  inputField(
    name,
    label,
    value,
    "date",
    help,
    'min="1900-01-01" max="2199-12-31"',
  );
const numberField = (name, label, value, help = "") =>
  inputField(
    name,
    label,
    value,
    "text",
    help,
    'inputmode="decimal" autocomplete="off"',
  );
function formFooter(label = "Save draft") {
  return `<div class="form-message" role="alert"></div><div class="dialog-footer"><span>Saved locally. Recalculated on save.</span><div>${btn("Cancel", "cancel-dialog", "secondary")}<button class="btn primary" type="submit">${icon("check")}${label}</button></div></div>`;
}
function formErrors(prefix = "") {
  for (const e of state.errors) {
    if (prefix && !e.path.startsWith(prefix)) continue;
    let name = prefix ? e.path.slice(prefix.length) : e.path;
    if (["principal", "payment"].includes(name) && $("#f-loanValue"))
      name = "loanValue";
    const target = $("#editor").querySelector(
      `[data-field-error="${CSS.escape(name)}"]`,
    );
    if (target) {
      target.textContent = e.message;
      target.closest(".field")?.classList.add("invalid");
      target
        .closest(".field")
        ?.querySelector("input,select")
        ?.setAttribute("aria-invalid", "true");
    } else if (name.startsWith("rows.")) {
      const parts = name.split("."),
        row = $("#custom-rows")?.children[Number(parts[1])];
      if (row) {
        row
          .querySelector(`[data-row="${parts[2]}"]`)
          ?.setAttribute("aria-invalid", "true");
        const message = document.createElement("small");
        message.className = "custom-row-error";
        message.textContent = e.message;
        row.append(message);
      }
    }
  }
}
function editScenario() {
  const s = state.scenario;
  showDialog(
    "Scenario assumptions",
    `<form id="scenario-form" novalidate><p class="form-intro">Define the full time horizon and the cash you already have. Include the last repayment and maturity of every object.</p>${inputField("name", "Scenario name", s.name, "text", "", 'maxlength="120"')}<div class="form-grid">${dateField("start", "Scenario start · valuation date", s.start)}${dateField("end", "Scenario end · included", s.end)}${selectField("currency", "Currency", s.currency, { USD: "USD · US dollar (2 decimals)", EUR: "EUR · Euro (2 decimals)", GBP: "GBP · Pound sterling (2 decimals)", CAD: "CAD · Canadian dollar (2 decimals)", AUD: "AUD · Australian dollar (2 decimals)", CHF: "CHF · Swiss franc (2 decimals)", JPY: "JPY · Japanese yen (0 decimals)", KWD: "KWD · Kuwaiti dinar (3 decimals)" }, "One currency for the whole plan. Changing it relabels amounts; it does not convert them.")}${numberField("openingCash", "Opening cash", s.openingCash, "Available before the first day’s cashflows. Zero or positive.")}${numberField("discountRate", "Annual discount rate (%)", s.discountRate, "An effective annual hurdle rate, greater than −100%. Opening cash is excluded from NPV.")}</div>${formFooter("Save assumptions")}</form>`,
  );
  formErrors();
  $("#scenario-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(async () => {
      const values = Object.fromEntries(new FormData(e.target));
      await saveScenario({ ...s, ...values });
    });
  };
}
function defaults(type) {
  const s = state.scenario;
  return {
    id: crypto.randomUUID(),
    name: "",
    type,
    start: s.start,
    end: s.end,
    frequency: "monthly",
    firstPayment: "",
    amount: "",
    rate: "0",
    rateBasis: "nominal",
    method: "principal",
    principal: "",
    payments: 12,
    payout: "maturity",
    growthMode: "none",
    growthRate: "0",
    rows: [{ date: s.start, amount: "", note: "" }],
  };
}
function editObject(id, type) {
  const original = id ? state.scenario.objects.find((o) => o.id === id) : null;
  const o = structuredClone(original || defaults(type));
  objectForm(o, !!original);
}
function objectForm(o, existing) {
  let typeFields = "";
  if (o.type === "loan") {
    typeFields = `<div class="form-grid">${selectField("method", "What do you know?", o.method, { principal: "Known principal → calculate payment", payment: "Known payment → calculate principal" })}${numberField("loanValue", o.method === "principal" ? "Principal received" : "Regular repayment", o[o.method] || "", "Enter a positive amount. The other amount is derived.")}<div class="field-help full">The final repayment clears all remaining principal and posted interest, including currency rounding.</div>${numberField("payments", "Number of repayments", o.payments, "A whole number from 1 to 1,200.")}${selectField("frequency", "Repayment frequency", o.frequency, frequencyNames)}${dateField("start", "Loan received on", o.start)}${dateField("firstPayment", "First repayment · optional", o.firstPayment, "Blank means one full period after receipt. A different date changes first-period interest.")}</div>`;
  } else if (o.type === "investment") {
    typeFields = `<div class="form-grid">${numberField("amount", "Amount invested", o.amount, "A positive deposit amount; the cashflow is negative.")}${selectField("payout", "When is interest available?", o.payout, { maturity: "At maturity · interest compounds", periodic: "As earned · interest paid out" })}${dateField("start", "Deposit date", o.start)}${dateField("end", "Maturity date", o.end)}${selectField("frequency", "Compounding / payout frequency", o.frequency, frequencyNames, "A term shorter than one period receives prorated interest at maturity.")}</div>`;
  } else if (o.type === "income" || o.type === "expense") {
    typeFields = `<div class="form-grid">${numberField("amount", o.type === "income" ? "Starting income per payment" : "Starting expense per payment", o.amount, "Enter a positive amount. The object determines the cashflow sign.")}${selectField("frequency", "Payment frequency", o.frequency, frequencyNames)}${dateField("start", "Object start date", o.start)}${dateField("end", "Object end date · included", o.end)}${dateField("firstPayment", "First payment · optional", o.firstPayment, "Blank means one full period after the start. Set the start date here for an immediate payment.")}${selectField("growthMode", "How does the payment change?", o.growthMode, { none: "Fixed · no growth", annual: "Annual anniversary", payment: "Every payment" })}${numberField("growthRate", o.growthMode === "payment" ? `Growth per ${o.frequency === "monthly" ? "monthly" : o.frequency === "quarterly" ? "quarterly" : "yearly"} payment (%)` : "Annual anniversary growth (%)", o.growthRate, "Greater than −100%. The first payment uses your starting amount. Annual growth starts one year after that first payment.")}</div>`;
  } else {
    typeFields = `<p class="form-intro">Enter each date and signed amount. <strong>Positive = received. Negative = paid.</strong> Multiple rows on the same date stay separate.</p>${o.copiedFrom ? '<div class="inline-warning">' + icon("warn") + "This is an independent copy. The original stays unchanged. Both schedules count while both are in this scenario; duplicate the scenario first if you want to replace the original in an alternative plan.</div>" : ""}<div class="custom-table"><div class="custom-row custom-head"><span>Date</span><span>Signed amount</span><span>Note / source rule</span><span></span></div><div id="custom-rows">${o.rows.map((r, i) => customRow(r, i)).join("")}</div></div><button class="btn secondary" type="button" id="add-custom-row">${icon("plus")}Add cashflow row</button>`;
  }
  const rateFields = ["loan", "investment"].includes(o.type)
    ? `<fieldset class="rate-fieldset"><legend>Make the rate’s meaning explicit</legend><div class="form-grid">${numberField("rate", "Entered interest rate (%)", o.rate)}${selectField("rateBasis", "Rate basis", o.rateBasis, rateNames)}</div><p class="rate-explainer" id="rate-explainer">${rateHelp(o.rateBasis, o.frequency)}</p></fieldset>`
    : "";
  showDialog(
    `${existing ? "Edit" : "Add"} ${typeNames[o.type].toLowerCase()}`,
    `<form id="object-form" novalidate>${inputField("name", "Object name", o.name, "text", "A clear name makes every payment easy to trace.", 'maxlength="120"')}${typeFields}${rateFields}${formFooter(existing ? "Save object" : "Add to scenario")}</form>`,
    o.type === "custom",
  );
  const index = state.scenario.objects.findIndex((x) => x.id === o.id);
  if (index >= 0) formErrors(`objects.${index}.`);
  $("#object-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(async () => {
      const object = collectObject(o);
      const doc = structuredClone(state.scenario);
      if (existing)
        doc.objects[doc.objects.findIndex((x) => x.id === o.id)] = object;
      else doc.objects.push(object);
      await saveScenario(doc);
    });
  };
  if ($("#f-method"))
    $("#f-method").onchange = () => {
      const field = $("#f-loanValue");
      field.closest("label").querySelector("span").textContent =
        $("#f-method").value === "principal"
          ? "Principal received"
          : "Regular repayment";
      field.value = "";
    };
  for (const id of ["#f-rateBasis", "#f-frequency"])
    if ($(id))
      $(id).addEventListener("change", () => {
        if ($("#rate-explainer"))
          $("#rate-explainer").textContent = rateHelp(
            $("#f-rateBasis").value,
            $("#f-frequency").value,
          );
        if ($("#f-growthMode")) growthLabel();
      });
  if ($("#f-growthMode")) {
    $("#f-growthMode").onchange = () => {
      if ($("#f-growthMode").value === "none") $("#f-growthRate").value = "0";
      growthLabel();
    };
    growthLabel();
  }
  if (o.type === "custom") {
    wireCustomRows();
    $("#add-custom-row").onclick = () => {
      const rows = $("#custom-rows");
      rows.insertAdjacentHTML(
        "beforeend",
        customRow(
          { date: state.scenario.start, amount: "", note: "" },
          rows.children.length,
        ),
      );
      editorDirty = true;
      wireCustomRows();
      rows.lastElementChild.querySelector("input").focus();
    };
  }
}
function growthLabel() {
  const mode = $("#f-growthMode").value;
  $("#f-growthRate").closest("label").querySelector("span").textContent =
    mode === "payment"
      ? `Growth per ${$("#f-frequency").value} payment (%)`
      : mode === "none"
        ? "Growth (%) · fixed at zero"
        : "Annual anniversary growth (%)";
  $("#f-growthRate").readOnly = mode === "none";
}
function rateHelp(basis, freq) {
  const count = { monthly: 12, quarterly: 4, yearly: 1 }[freq];
  return {
    nominal: `Nominal annual: divide your rate by ${count} to get the rate for one ${freq} period.`,
    effective: `Effective annual: find the periodic rate whose ${count} compounded period(s) reproduce your annual rate.`,
    periodic: `Per period: your entered rate applies to every ${freq} period. It is not an annual rate.`,
  }[basis];
}
function customRow(row, index) {
  return `<div class="custom-row"><label><span>Date</span><input type="date" aria-label="Cashflow date ${index + 1}" data-row="date" value="${esc(row.date)}"></label><label><span>Signed amount</span><input type="text" inputmode="decimal" aria-label="Signed amount ${index + 1}" data-row="amount" value="${esc(row.amount)}" placeholder="e.g. -250.00"></label><label class="custom-note"><span>Note / source rule</span><input type="text" aria-label="Cashflow note ${index + 1}" data-row="note" value="${esc(row.note)}" maxlength="300"></label><button class="icon-button danger-text" type="button" data-remove-row aria-label="Remove cashflow row ${index + 1}">${icon("trash")}</button></div>`;
}
function wireCustomRows() {
  Array.from($("#custom-rows").children).forEach((row, index) => {
    for (const [key, label] of [
      ["date", "Cashflow date"],
      ["amount", "Signed amount"],
      ["note", "Cashflow note"],
    ])
      row
        .querySelector(`[data-row="${key}"]`)
        .setAttribute("aria-label", `${label} ${index + 1}`);
    const b = row.querySelector("[data-remove-row]");
    b.setAttribute("aria-label", `Remove cashflow row ${index + 1}`);
    b.onclick = () => {
      if ($("#custom-rows").children.length === 1) {
        toast("Keep at least one cashflow row.", true);
        return;
      }
      row.remove();
      editorDirty = true;
      wireCustomRows();
    };
  });
  $("#custom-rows").oninput = () => (editorDirty = true);
}
function collectObject(o) {
  const v = Object.fromEntries(new FormData($("#object-form")));
  let result = { id: o.id, type: o.type, name: v.name };
  if (o.type === "custom") {
    result.rows = Array.from($("#custom-rows").children).map((el) =>
      Object.fromEntries(
        Array.from(el.querySelectorAll("[data-row]")).map((i) => [
          i.dataset.row,
          i.value,
        ]),
      ),
    );
    if (o.copiedFrom) result.copiedFrom = o.copiedFrom;
    return result;
  }
  result = { ...result, start: v.start, frequency: v.frequency };
  if (o.type === "loan") {
    result = {
      ...result,
      method: v.method,
      [v.method]: v.loanValue,
      payments: /^\d+$/.test(v.payments) ? Number(v.payments) : v.payments,
      firstPayment: v.firstPayment,
    };
  } else {
    result = { ...result, amount: v.amount, end: v.end };
    if (o.type === "investment") result.payout = v.payout;
    else
      result = {
        ...result,
        growthMode: v.growthMode,
        growthRate: v.growthRate,
        firstPayment: v.firstPayment,
      };
  }
  if (["loan", "investment"].includes(o.type))
    result = { ...result, rate: v.rate, rateBasis: v.rateBasis };
  return result;
}
async function submitForm(fn) {
  const form = $("#editor form"),
    submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await fn();
    editorDirty = false;
    $("#editor").close();
  } catch (error) {
    form.querySelector(".form-message").textContent =
      error.message ||
      "The server is unavailable. Your form is still here; start the application and save again.";
  } finally {
    submit.disabled = false;
  }
}
function fix(path) {
  const parts = path.split(".");
  if (parts[0] === "objects" && parts[1] !== undefined) {
    const o = state.scenario.objects[Number(parts[1])];
    if (o) editObject(o.id);
    else goView("objects");
  } else editScenario();
}
function addObject() {
  showDialog(
    "Add a financial object",
    `<p class="form-intro">Choose the kind of cash movement you want to model.</p>${objectChoices()}`,
  );
}
function review() {
  if (state.errors.length) {
    showDialog("Review your scenario", validationPanel(), true);
    return;
  }
  const r = state.result;
  showDialog(
    "Review the complete plan",
    `<div class="review-intro"><h3>${esc(state.scenario.name)}</h3><p>${dateLabel(state.scenario.start)} — ${dateLabel(state.scenario.end)} · ${state.scenario.objects.length} objects · ${r.flows.length} dated payments</p><p>Opening cash ${amount(state.scenario.openingCash)} · Discount rate ${esc(state.scenario.discountRate)}% · ${esc(state.scenario.currency)}</p></div><div class="review-objects">${state.scenario.objects.map((o) => `<div><span>${icon(o.type)}<strong>${esc(o.name)}</strong></span><p>${objectDescription(o)}</p>${reviewInputs(o)}<button class="text-button" data-edit="${esc(o.id)}">Edit</button></div>`).join("") || "<p>This plan contains only opening cash. No financial returns or costs are modeled.</p>"}</div>${conclusion()}<div class="review-warnings">${warningsMarkup()}${r.assumptions.map((a) => `<p class="assumption-notice"><strong>${esc(a.objectName)}:</strong> ${esc(a.message)}</p>`).join("")}</div><p class="form-intro">The model uses 30E/360, rounds posted money to ${digits()} decimal places, and includes the complete economic life of every object. View the Assumptions screen for every entered rate, date and convention.</p>${r.warnings.length ? '<label class="accept-warning"><input type="checkbox" id="accept-warnings">I understand that these dates may require inflows to arrive before payments can settle.</label>' : ""}<div class="form-message" role="alert"></div><div class="dialog-footer"><button class="btn secondary" data-action="cancel-dialog">Keep editing</button><button class="btn primary" id="confirm-scenario" ${r.warnings.length ? "disabled" : ""}>${icon("check")}Confirm this scenario</button></div>`,
    true,
  );
  if ($("#accept-warnings"))
    $("#accept-warnings").onchange = (e) =>
      ($("#confirm-scenario").disabled = !e.target.checked);
  $("#confirm-scenario").onclick = () =>
    safe(async () => {
      const { scenario, result } = await api(
        "/api/scenarios/" + state.scenario.id + "/confirm",
        "POST",
        {
          revision: state.scenario.revision,
          acceptWarnings: $("#accept-warnings")?.checked || false,
        },
      );
      replaceScenario(scenario);
      state.result = result;
      editorDirty = false;
      $("#editor").close();
      state.view = "overview";
      render();
      toast(
        "Scenario confirmed. Results and accepted warnings are saved for this revision.",
      );
    });
}
function confirmDelete(title, text, action) {
  showDialog(
    title,
    `<p class="form-intro">${text}</p><div class="dialog-footer"><button class="btn secondary" data-action="cancel-dialog">Cancel</button><button class="btn danger" id="delete-confirm">${icon("trash")}Delete</button></div>`,
  );
  $("#delete-confirm").onclick = () =>
    safe(async () => {
      await action();
      editorDirty = false;
      $("#editor").close();
    });
}
function copyCustom(id) {
  const original = state.scenario.objects.find((o) => o.id === id);
  const flows = state.result.flows.filter((f) => f.objectId === id);
  objectForm(
    {
      id: crypto.randomUUID(),
      type: "custom",
      name: original.name.slice(0, 95) + " · custom copy",
      copiedFrom: original.name,
      rows: flows.map((f) => ({
        date: f.date,
        amount: f.amount,
        note: f.rule,
      })),
    },
    false,
  );
}
function downloadURL(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}
async function importBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () =>
    safe(async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 8_000_000)
        throw new Error("Choose a backup smaller than 8 MB.");
      const body = JSON.parse(await file.text());
      const result = await api("/api/import", "POST", body);
      state.scenarios = (await api("/api/scenarios")).scenarios;
      render();
      toast(
        `Imported ${result.imported} scenarios as new drafts. Existing scenarios are preserved.`,
      );
    });
  input.click();
}
function guide() {
  showDialog(
    "How the studio works",
    `<div class="guide prose"><h3>Build one complete financial story</h3><p>Create a scenario with a start and end date, opening cash, and an annual discount rate. Add each loan, investment, income, expense, and irregular payment. Save drafts freely, then use <strong>Review & confirm</strong> to validate the complete plan.</p><h3>Choose the right rate meaning</h3><p><strong>Yearly split evenly</strong> is a nominal annual rate divided across periods. <strong>Yearly true cost</strong> is an effective annual rate that already includes compounding. <strong>Per payment period</strong> means the entered rate applies each month, quarter or year you selected.</p><h3>Read both results</h3><p><strong>Cash feasibility</strong> checks every day’s closing balance. A shortfall means cash is unavailable before a later receipt; the model does not create an overdraft. <strong>Net present value</strong> discounts only the modeled cashflows to the scenario start. Opening cash can fix liquidity but cannot improve the plan’s NPV.</p><h3>Explore the timing</h3><p>Zoom or pan the chart, filter payments by object, and inspect any date. Hiding bars changes the view only. Cash calculations always include every object. The Payments screen shows interest, principal and remaining obligation for a selected loan.</p><h3>Test an alternative</h3><p>Duplicate a scenario before replacing a standard object with a modified custom copy. The copy is independent; while both objects exist, both schedules count. Changing any saved input recalculates the plan and clears its previous confirmation.</p><h3>Keep your work</h3><p>Use the same application folder to retain your local SQLite database. Saved drafts and confirmed inputs survive a restart. Export a JSON backup from the library and import it to restore independent drafts. Downloads contain your financial data and stay wherever your browser saves them.</p><h3>Understand the limits</h3><p>Use one currency per scenario. No automatic exchange conversion, tax, fee, inflation adjustment, interest on idle cash, or investment liquidation is added. Inputs support 1900–2199, horizons up to 100 years, 200 objects and 25,000 payments. Money, discounting and rate conversions use 60-digit decimal arithmetic.</p></div><div class="dialog-footer"><button class="btn primary" data-action="cancel-dialog">Back to the studio</button></div>`,
    true,
  );
}

const actions = {
  library: () => {
    state.scenario = null;
    state.result = null;
    state.errors = [];
    requestVersion++;
    location.hash = "";
    render();
  },
  new: () => newScenario(),
  demo: () => newScenario("demo"),
  guide,
  "edit-scenario": editScenario,
  "add-object": addObject,
  review,
  "clear-filters": () => {
    state.paymentFilter = "";
    state.search = "";
    state.from = "";
    state.to = "";
    state.page = 0;
    render();
  },
  "jump-lowest": () => inspect(state.result.summary.lowest.date),
  duplicate: async () => {
    const { scenario } = await api(
      "/api/scenarios/" + state.scenario.id + "/duplicate",
      "POST",
      {},
    );
    state.scenarios.unshift(scenario);
    await openScenario(scenario.id);
    toast("An independent scenario copy is ready to edit.");
  },
  "delete-scenario": () =>
    confirmDelete(
      "Delete this scenario?",
      `“${esc(state.scenario.name)}” and its objects will be removed from this local workspace. Export a backup first if you need a separate copy.`,
      async () => {
        await api("/api/scenarios/" + state.scenario.id, "DELETE", {
          revision: state.scenario.revision,
        });
        state.scenarios = state.scenarios.filter(
          (s) => s.id !== state.scenario.id,
        );
        state.scenario = null;
        state.result = null;
        location.hash = "";
        render();
        toast("Scenario deleted.");
      },
    ),
  backup: () => downloadURL("/api/backup", "forecast-studio-backup.json"),
  import: importBackup,
  "export-payments": () =>
    downloadURL(
      "/api/scenarios/" +
        state.scenario.id +
        "/payments.csv" +
        (state.paymentFilter
          ? "?object=" + encodeURIComponent(state.paymentFilter)
          : ""),
      "forecast-payments.csv",
    ),
  "export-balance": () =>
    downloadURL(
      "/api/scenarios/" + state.scenario.id + "/balance.csv",
      "forecast-daily-balances.csv",
    ),
};
function wire() {
  const app = $("#app");
  app.querySelectorAll("[data-action]").forEach(
    (el) =>
      (el.onclick = () =>
        safe(async () => {
          const key = el.dataset.action;
          if (
            [
              "pan-left",
              "pan-right",
              "zoom-in",
              "zoom-out",
              "reset-range",
            ].includes(key)
          )
            adjustRange(key);
          else if (actions[key]) await actions[key]();
        })),
  );
  app
    .querySelectorAll("[data-open]")
    .forEach(
      (el) => (el.onclick = () => safe(() => openScenario(el.dataset.open))),
    );
  app
    .querySelectorAll("[data-view]")
    .forEach((el) => (el.onclick = () => goView(el.dataset.view)));
  app
    .querySelectorAll("[data-add-type]")
    .forEach((el) => (el.onclick = () => editObject(null, el.dataset.addType)));
  app
    .querySelectorAll("[data-edit]")
    .forEach((el) => (el.onclick = () => editObject(el.dataset.edit)));
  app
    .querySelectorAll("[data-schedule]")
    .forEach((el) => (el.onclick = () => schedule(el.dataset.schedule)));
  app
    .querySelectorAll("[data-inspect]")
    .forEach((el) => (el.onclick = () => inspect(el.dataset.inspect)));
  app
    .querySelectorAll("[data-fix]")
    .forEach((el) => (el.onclick = () => fix(el.dataset.fix)));
  app
    .querySelectorAll("[data-copy-custom]")
    .forEach((el) => (el.onclick = () => copyCustom(el.dataset.copyCustom)));
  app.querySelectorAll("[data-delete-object]").forEach(
    (el) =>
      (el.onclick = () => {
        const id = el.dataset.deleteObject,
          o = state.scenario.objects.find((x) => x.id === id);
        confirmDelete(
          "Delete this financial object?",
          `Remove “${esc(o.name)}” and all its cashflows from this scenario? The plan will be recalculated.`,
          async () => {
            const doc = structuredClone(state.scenario);
            doc.objects = doc.objects.filter((x) => x.id !== id);
            await saveScenario(doc);
          },
        );
      }),
  );
  app.querySelectorAll("[data-duplicate-object]").forEach(
    (el) =>
      (el.onclick = () =>
        safe(async () => {
          const doc = structuredClone(state.scenario),
            o = structuredClone(
              doc.objects.find((x) => x.id === el.dataset.duplicateObject),
            );
          o.id = crypto.randomUUID();
          o.name = o.name.slice(0, 110) + " · copy";
          doc.objects.push(o);
          await saveScenario(doc);
        })),
  );
  app.querySelectorAll("[data-page-kind]").forEach(
    (el) =>
      (el.onclick = () => {
        if (el.dataset.pageKind === "payment")
          state.page = Number(el.dataset.page);
        else state.dayPage = Number(el.dataset.page);
        const scroll = window.scrollY;
        render();
        window.scrollTo(0, scroll);
      }),
  );
  for (const [id, key] of [
    ["payment-object", "paymentFilter"],
    ["payment-search", "search"],
    ["payment-from", "from"],
    ["payment-to", "to"],
  ])
    if ($("#" + id))
      $("#" + id).onchange = (e) => {
        state[key] = e.target.value;
        state.page = 0;
        render();
      };
  if ($("#inspect-date"))
    $("#inspect-date").onchange = (e) => {
      if (state.result.daily.some((d) => d.date === e.target.value))
        inspect(e.target.value);
      else toast("Choose a date inside this scenario.", true);
    };
  for (const field of ["chart-from", "chart-to"])
    if ($("#" + field))
      $("#" + field).onchange = () => {
        const from = $("#chart-from").value,
          to = $("#chart-to").value,
          lo = state.result.daily.findIndex((d) => d.date === from),
          hi = state.result.daily.findIndex((d) => d.date === to);
        if (lo < 0 || hi < 0 || hi <= lo) {
          toast(
            "Choose a start and a later end inside the scenario horizon.",
            true,
          );
          return;
        }
        state.range = [lo, hi];
        const pos = window.scrollY;
        render();
        window.scrollTo(0, pos);
      };
  if ($("#chart-pan"))
    $("#chart-pan").onchange = (e) => {
      const width =
          (state.range[1] ?? state.result.daily.length - 1) - state.range[0],
        lo = Number(e.target.value);
      state.range = [lo, lo + width];
      const pos = window.scrollY;
      render();
      window.scrollTo(0, pos);
    };
}
window.addEventListener("beforeunload", (e) => {
  if (editorDirty && $("#editor").open) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#editor").open) $("#toast").className = "";
});
async function init() {
  try {
    state.scenarios = (await api("/api/scenarios")).scenarios;
    const id = location.hash.slice(1);
    if (id && state.scenarios.some((s) => s.id === id)) await openScenario(id);
    else render();
  } catch (error) {
    $("#app").innerHTML =
      `<main class="connection-error"><h1>Start your local studio</h1><p>The application could not reach its local server. Run <code>python run.py</code> in the application folder, then reload this page.</p><button class="btn primary" id="retry-load">Try again</button></main>`;
    $("#retry-load").onclick = init;
  }
}
init();
