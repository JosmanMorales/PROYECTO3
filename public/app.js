
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const el = {
  themeToggle: $("#themeToggle"),
  algo: $("#algorithm"),
  quantum: $("#quantum"),
  tick: $("#tick"),
  start: $("#start"),
  pause: $("#pause"),
  reset: $("#reset"),
  name: $("#name"),
  arrival: $("#arrival"),
  burst: $("#burst"),
  addProcess: $("#addProcess"),
  processList: $("#processList"),
  gantt: $("#gantt"),
  queue: $("#queue"),
  resultsTable: $("#resultsTable tbody"),
  tickDisplay: $("#tickDisplay"),
};

let processes = [];


let sim = Scheduler.createSimulator(processes, {
  algo: el.algo.value, quantum: +el.quantum.value, tickMs: +el.tick.value * 1000
});

// Suscripción para refrescar UI
sim.subscribe(updateUI);

// ---------- UI Handlers ----------
el.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
});

el.addProcess.addEventListener("click", () => {
  const name = (el.name.value || "").trim() || `P${processes.length + 1}`;
  const arrival = Math.max(0, parseInt(el.arrival.value || "0", 10));
  const burst = Math.max(1, parseInt(el.burst.value || "1", 10));
  processes.push({ id: rid(), name, arrival, burst });
  sim = Scheduler.createSimulator(processes, {
    algo: el.algo.value, quantum: +el.quantum.value, tickMs: +el.tick.value * 1000
  });
  sim.subscribe(updateUI);
  renderProcessList();
  clearInputs();
});

el.start.addEventListener("click", () => sim.start());
el.pause.addEventListener("click", () => sim.pause());
el.reset.addEventListener("click", () => { sim.reset(true); });

el.algo.addEventListener("change", e => sim.setAlgorithm(e.target.value));
el.quantum.addEventListener("change", e => sim.setQuantum(+e.target.value || 1));
el.tick.addEventListener("change", e => {
  const sec = Math.max(1, +e.target.value || 3);
  el.tickDisplay.textContent = sec;
  sim.setTickMs(sec * 1000);
});

// Inicializar
renderProcessList();
el.tickDisplay.textContent = el.tick.value;

// ---------- Render helpers ----------
function renderProcessList() {
  el.processList.innerHTML = "";
  processes.forEach((p, idx) => {
    const row = document.createElement("div");
    row.innerHTML = `
      <strong style="display:inline-flex;align-items:center;gap:.5em;">
        <span style="display:inline-block;width:12px;height:12px;background:${Scheduler.colors[idx%Scheduler.colors.length]};border-radius:2px"></span>
        ${p.name}
      </strong>
      <span> L=${p.arrival} • CPU=${p.burst}</span>
      <button data-id="${p.id}" style="float:right;background:#ef4444">Eliminar</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      processes = processes.filter(x => x.id !== p.id);
      sim = Scheduler.createSimulator(processes, {
        algo: el.algo.value, quantum: +el.quantum.value, tickMs: +el.tick.value * 1000
      });
      sim.subscribe(updateUI);
      renderProcessList();
    });
    el.processList.appendChild(row);
  });
}

function updateUI(state) {
  // Botones
  el.start.disabled = state.running || state.finished;
  el.pause.disabled = !state.running;
  el.reset.disabled = state.running;

  // Gantt
  renderGantt(state);

  // RR queue
  renderQueue(state);

  // Resultados
  renderResults(state);

  // Footer tick
  el.tickDisplay.textContent = Math.round(state.tickMs / 1000);
}

function renderGantt(state) {
  const total = Math.max(state.time, ...state.timeline.map(s => s.end), 1);
  el.gantt.innerHTML = "";

  // marcas de tiempo
  const marks = document.createElement("div");
  marks.style.width = "100%";
  marks.style.display = "flex";
  marks.style.flexWrap = "wrap";
  for (let t = 0; t < total; t++) {
    const m = document.createElement("div");
    m.textContent = t;
    m.style.fontSize = "10px";
    m.style.color = "#888";
    m.style.width = "30px";
    m.style.textAlign = "center";
    el.gantt.appendChild(m);
  }

  // Render por slices
  state.timeline.forEach(sl => {
    const len = sl.end - sl.start;
    const block = document.createElement("div");
    block.className = "gantt-block";
    block.style.minWidth = (30 * len) + "px";
    block.style.background = sl.pid === "IDLE" ? "#64748b" : (state.colors[sl.pid] || "#333");
    block.textContent = sl.pid === "IDLE" ? "IDLE" : (state.stats.find(p => p.id === sl.pid)?.name || sl.pid);
    el.gantt.appendChild(block);
  });
}

function renderQueue(state) {
  el.queue.innerHTML = "";
  if (state.algo !== "RR") {
    el.queue.innerHTML = `<div>Solo visible en Round Robin</div>`;
    return;
  }
  if (state.queue.length === 0) {
    el.queue.innerHTML = `<div>Vacía</div>`;
    return;
  }
  state.queue.forEach(id => {
    const name = state.stats.find(p => p.id === id)?.name || id;
    const tag = document.createElement("div");
    tag.textContent = name;
    el.queue.appendChild(tag);
  });
}

function renderResults(state) {
  const { rows, avgs, best } = state.results;
  el.resultsTable.innerHTML = "";
  if (!rows.length) {
    el.resultsTable.innerHTML = `<tr><td colspan="9">Agrega procesos y ejecuta una simulación…</td></tr>`;
    return;
  }
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (best === r.id) tr.style.background = "rgba(16,185,129,.15)";
    tr.innerHTML = `
      <td><strong>${r.name}</strong></td>
      <td>${r.arrival}</td>
      <td>${r.burst}</td>
      <td>${val(r.firstStart)}</td>
      <td>${val(r.completion)}</td>
      <td>${val(r.turnaround)}</td>
      <td>${val(r.waiting)}</td>
      <td>${val(r.response)}</td>
      <td>${val(r.efficiency)}</td>
    `;
    el.resultsTable.appendChild(tr);
  });
  const tfoot = document.createElement("tr");
  tfoot.innerHTML = `
    <td style="font-weight:600">Promedios</td>
    <td></td><td></td><td></td><td></td>
    <td>${avgs.turnaround}</td>
    <td>${avgs.waiting}</td>
    <td>${avgs.response}</td>
    <td>${avgs.efficiency}</td>
  `;
  el.resultsTable.appendChild(tfoot);
}

function val(v) { return (v === null || v === undefined) ? "-" : v; }
function rid() { return Math.random().toString(36).slice(2, 9); }
function clearInputs() { el.name.value = ""; el.arrival.value = ""; el.burst.value = ""; }
