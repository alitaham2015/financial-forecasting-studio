// Numbers are used only for graphical coordinates, never financial results.
export const COLORS = [
  "#3567e9",
  "#9370db",
  "#159482",
  "#d89830",
  "#da6372",
  "#5595b4",
];
export function color(index) {
  return index < COLORS.length
    ? COLORS[index]
    : `hsl(${(index * 137.508) % 360} 55% 46%)`;
}
export function chartMarkup(result, scenario, range, hidden, escape, format) {
  const daily = result.daily;
  const maxIndex = daily.length - 1;
  const lo = Math.max(0, range[0]),
    hi = Math.min(maxIndex, range[1] ?? maxIndex);
  const visible = daily.slice(lo, hi + 1);
  if (!visible.length) return "";
  const W = 1100,
    L = 78,
    R = 1075,
    top = 24,
    bottom = 215,
    cashZero = 313;
  const dateIndex = new Map(daily.map((d, i) => [d.date, i]));
  const x = (i) => L + ((i - lo) / Math.max(hi - lo, 1)) * (R - L);
  let min = 0,
    max = 1;
  for (const d of visible) {
    min = Math.min(min, Number(d.balance));
    max = Math.max(max, Number(d.balance));
  }
  const span = max - min || 1;
  min -= span * 0.08;
  max += span * 0.12;
  const y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const short = (n) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  const points = visible
    .map((d, i) => `${x(i + lo).toFixed(2)},${y(Number(d.balance)).toFixed(2)}`)
    .join(" ");
  const ids = new Map(scenario.objects.map((o, i) => [o.id, i]));
  const rows = result.flows.filter(
    (f) =>
      Number(f.amount) !== 0 &&
      f.date >= visible[0].date &&
      f.date <= visible.at(-1).date &&
      !hidden.has(f.objectId),
  );
  const sums = new Map();
  for (const f of rows) {
    const key = f.date + (Number(f.amount) < 0 ? "-" : "+");
    sums.set(key, (sums.get(key) || 0) + Math.abs(Number(f.amount)));
  }
  const maxFlow = Math.max(1, ...sums.values());
  const barScale = 55 / maxFlow,
    running = new Map();
  const barWidth = Math.max(
    3,
    Math.min(13, ((R - L) / Math.max(hi - lo, 1)) * 0.7),
  );
  const bars = rows
    .map((f) => {
      const v = Number(f.amount),
        neg = v < 0,
        key = f.date + (neg ? "-" : "+"),
        previous = running.get(key) || 0;
      running.set(key, previous + Math.abs(v));
      const height = Math.abs(v) * barScale,
        by = neg
          ? cashZero + previous * barScale
          : cashZero - (previous + v) * barScale;
      const idx = ids.get(f.objectId) || 0;
      return `<rect class="flow-bar" tabindex="0" data-flow="${escape(f.id)}" x="${(x(dateIndex.get(f.date)) - (neg ? 0 : barWidth)).toFixed(2)}" y="${by.toFixed(2)}" width="${barWidth}" height="${Math.max(height, 1).toFixed(2)}" fill="url(#pattern-${idx})" aria-label="${escape(`${f.date}: ${f.objectName}, ${format(f.amount, true)}; closing balance ${format(f.closingBalance)}`)}"><title>${escape(`${f.date} · ${f.objectName}\n${format(f.amount, true)}\nClosing cash ${format(f.closingBalance)}`)}</title></rect>`;
    })
    .join("");
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const value = min + ((max - min) * i) / 4,
      py = y(value);
    return `<line x1="${L}" x2="${R}" y1="${py}" y2="${py}" class="chart-grid"/><text x="${L - 13}" y="${py + 4}" text-anchor="end">${short(value)}</text>`;
  }).join("");
  const dateTicks = Array.from({ length: 5 }, (_, i) =>
    Math.round(lo + ((hi - lo) * i) / 4),
  )
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(
      (idx) =>
        `<text x="${x(idx)}" y="404" text-anchor="middle">${daily[idx].date.slice(5)}${iYear(daily[idx].date)}</text>`,
    )
    .join("");
  const patterns = scenario.objects
    .map(
      (o, i) =>
        `<pattern id="pattern-${i}" width="${5 + (i % 7)}" height="${5 + (i % 7)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${(i * 37) % 180})"><rect width="12" height="12" fill="${color(i)}"/><path d="M0 0V12" stroke="white" stroke-opacity="0.32" stroke-width="${1 + (i % 2)}"/></pattern>`,
    )
    .join("");
  const low = result.summary.lowest;
  const lowIndex = dateIndex.get(low.date);
  const lowMark =
    lowIndex >= lo && lowIndex <= hi
      ? `<circle cx="${x(lowIndex)}" cy="${y(Number(low.balance))}" r="5" fill="${Number(low.balance) < 0 ? "#ce4c5c" : "#235ce7"}" stroke="white" stroke-width="2"><title>Lowest closing balance: ${escape(format(low.balance))} on ${low.date}</title></circle>`
      : "";
  return `<div class="chart-legend-top"><span><i class="line-key"></i>Closing cash balance</span><span class="muted">${escape(scenario.currency)} · daily closing values</span></div><div class="chart-scroll"><svg id="cash-chart" viewBox="0 0 ${W} 424" role="img" aria-label="Cash balance and signed payments from ${visible[0].date} to ${visible.at(-1).date}. Use the date inspector or payment table for exact values."><defs>${patterns}<linearGradient id="cash-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3567e9" stop-opacity="0.14"/><stop offset="100%" stop-color="#3567e9" stop-opacity="0.01"/></linearGradient></defs>${ticks}<line x1="${L}" x2="${R}" y1="${y(0)}" y2="${y(0)}" class="chart-zero"/><polygon points="${x(lo)},${y(0)} ${points} ${x(hi)},${y(0)}" fill="url(#cash-fill)"/><polyline points="${points}" class="balance-line"/>${lowMark}<text x="${L}" y="251" class="chart-caption">DATED PAYMENTS · independent scale</text><line x1="${L}" x2="${R}" y1="${cashZero}" y2="${cashZero}" class="chart-zero"/><text x="${L - 13}" y="285" text-anchor="end">+${short(maxFlow)}</text><text x="${L - 13}" y="361" text-anchor="end">−${short(maxFlow)}</text>${bars}${dateTicks}<line id="chart-cursor" x1="${L}" x2="${L}" y1="${top}" y2="382" class="chart-cursor" visibility="hidden"/></svg></div><div class="chart-helper">Hover over the timeline or focus a payment bar for exact values. Click a date to inspect its payments.</div><div class="object-legend">${scenario.objects.map((o, i) => `<label class="legend-item" style="--object-color:${color(i)}"><input type="checkbox" data-legend="${escape(o.id)}" ${hidden.has(o.id) ? "" : "checked"}><span class="object-number">${String(i + 1).padStart(2, "0")}</span>${escape(o.name)}</label>`).join("")}</div><p class="micro">Visibility controls change the bars only. All objects remain included in the cash balance and results.</p>`;
}
function iYear(date) {
  return ` '${date.slice(2, 4)}`;
}

export function wireChart(
  container,
  result,
  range,
  format,
  onInspect,
  onToggle,
  escape,
) {
  const flowsById = new Map(result.flows.map((f) => [f.id, f]));
  const indexByDate = new Map(result.daily.map((d, i) => [d.date, i]));
  container
    .querySelectorAll("[data-legend]")
    .forEach((el) =>
      el.addEventListener("change", () => onToggle(el.dataset.legend)),
    );
  const svg = container.querySelector("#cash-chart");
  if (!svg) return;
  const tooltip = container.querySelector(".chart-tooltip");
  const cursor = svg.querySelector("#chart-cursor");
  const hi = range[1] ?? result.daily.length - 1,
    lo = range[0];
  let chosen = lo;
  function show(idx, flow) {
    chosen = idx;
    const row = result.daily[idx];
    if (!row) return;
    const px = 78 + ((idx - lo) / Math.max(hi - lo, 1)) * 997;
    cursor.setAttribute("x1", String(px));
    cursor.setAttribute("x2", String(px));
    cursor.setAttribute("visibility", "visible");
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${row.date}</strong>${flow ? `<span>${escape(flow.objectName)} · ${escape(format(flow.amount, true))}</span>` : ""}<span>Closing cash <b>${escape(format(row.balance))}</b></span><small>Received ${escape(format(row.inflows))} · paid ${escape(format(row.outflows))}</small>`;
  }
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * 1100;
    const idx = Math.max(
      lo,
      Math.min(hi, Math.round(lo + ((px - 78) / 997) * (hi - lo))),
    );
    const id = e.target.closest("[data-flow]")?.dataset.flow;
    show(idx, id ? flowsById.get(id) : null);
  });
  svg.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
  svg.addEventListener("click", () => onInspect(result.daily[chosen].date));
  svg.querySelectorAll("[data-flow]").forEach((el) => {
    const flow = flowsById.get(el.dataset.flow);
    el.addEventListener("focus", () => show(indexByDate.get(flow.date), flow));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onInspect(flow.date);
      }
    });
    el.addEventListener("blur", () => {
      tooltip.hidden = true;
    });
  });
}
