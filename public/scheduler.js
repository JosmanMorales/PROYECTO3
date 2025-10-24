
(function (global) {
  const COLORS = [
    "#4f46e5", "#059669", "#d97706", "#db2777", "#0891b2",
    "#7c3aed", "#16a34a", "#b91c1c", "#0d9488", "#1d4ed8"
  ];

  function uid() { return Math.random().toString(36).slice(2, 9); }

  class Simulator {
    constructor(processInputs, { algo = "FCFS", quantum = 2, tickMs = 3000 } = {}) {
      this.initial = processInputs.map(p => ({ ...p }));
      this.algo = algo;
      this.quantum = Math.max(1, +quantum || 2);
      this.tickMs = Math.max(250, +tickMs || 3000);

      this._interval = null;
      this._subs = [];
      this._colors = new Map();
      this.reset(true);
    }

    reset(keepAlgo = false) {
      if (this._interval) clearInterval(this._interval);
      this.time = 0;
      this.timeline = []; 
      this.queue = []; 
      this.current = null;
      this.rrQuantumLeft = this.quantum;
      this.finished = false;
      this.stats = this.initial.map((p, i) => ({
        id: p.id || uid(),
        name: p.name,
        arrival: +p.arrival,
        burst: +p.burst,
        firstStart: null,
        completion: null,
        remaining: +p.burst,
        executed: 0,
      }));
      // map colors
      this.stats.forEach((p, i) => this._colors.set(p.id, COLORS[i % COLORS.length]));
      if (!keepAlgo) this.algo = "FCFS";
      this._emit();
    }

    setAlgorithm(a) {
      if (!["FCFS", "SJF", "RR"].includes(a)) return;
      this.algo = a;
      this.reset(true);
    }
    setQuantum(q) { this.quantum = Math.max(1, +q || 1); this.rrQuantumLeft = this.quantum; this._emit(); }
    setTickMs(ms) { this.tickMs = Math.max(250, +ms || 3000); this._emit(); }

    start() {
      if (this.finished || this._interval) return;
      this._interval = setInterval(() => this._step(), this.tickMs);
    }
    pause() {
      if (this._interval) { clearInterval(this._interval); this._interval = null; }
      this._emit();
    }

    // Subscripción a actualizaciones del estado
    subscribe(fn) {
      this._subs.push(fn);
      fn(this._snapshot());
      return () => this._subs = this._subs.filter(s => s !== fn);
    }

    // ---- Internals ----
    _emit() {
      const snap = this._snapshot();
      this._subs.forEach(fn => fn(snap));
    }
    _snapshot() {
      return {
        algo: this.algo,
        quantum: this.quantum,
        tickMs: this.tickMs,
        time: this.time,
        timeline: this.timeline.slice(),
        queue: this.queue.slice(),
        stats: this.stats.map(p => ({ ...p })),
        colors: Object.fromEntries(this._colors),
        running: !!this._interval,
        finished: this.finished,
        results: computeResults(this.stats),
      };
    }

    _getReady(t) {
      const arrived = this.stats.filter(p => p.arrival <= t && p.remaining > 0);
      arrived.sort((a, b) => a.arrival - b.arrival);
      // mantener el actual al frente si existe
      if (this.current) {
        const cur = arrived.find(p => p.id === this.current);
        if (cur) return [cur, ...arrived.filter(p => p.id !== this.current)];
      }
      return arrived;
    }

    _pickFCFS(ready) { return ready[0] || null; }
    _pickSJF(ready) { return ready.slice().sort((a, b) => a.remaining - b.remaining)[0] || null; }

    _step() {
      // Terminado todo
      if (this.stats.every(p => p.remaining === 0)) {
        this.finished = true;
        clearInterval(this._interval);
        this._interval = null;
        this._emit();
        return;
      }

      const ready = this._getReady(this.time);
      let next = null;

      if (this.algo === "FCFS") next = this._pickFCFS(ready);

      if (this.algo === "SJF") {
        const cur = this.current ? this.stats.find(p => p.id === this.current) : null;
        if (cur && cur.remaining > 0) next = cur; // no expropiativo
        else next = this._pickSJF(ready);
      }

      if (this.algo === "RR") {
        // alimentar cola con llegados
        let rrQ = this.queue.slice();
        ready.forEach(p => {
          if (p.id !== this.current && p.remaining > 0 && !rrQ.includes(p.id))
            rrQ.push(p.id);
        });

        const cur = this.current ? this.stats.find(p => p.id === this.current) : null;
        const needSwitch = !cur || cur.remaining === 0 || this.rrQuantumLeft <= 0;
        if (needSwitch) {
          if (cur && cur.remaining > 0 && this.rrQuantumLeft <= 0) rrQ.push(cur.id);
          const candidateId = rrQ.shift() || null;
          next = candidateId ? this.stats.find(p => p.id === candidateId) : null;
          this.rrQuantumLeft = this.quantum;
        } else next = cur;

        this.queue = rrQ;
      }

      if (!next) {
        // CPU ociosa
        this._appendSlice("IDLE", 1);
        this.current = null;
        this.rrQuantumLeft = this.algo === "RR" ? this.rrQuantumLeft - 1 : this.rrQuantumLeft;
        this.time += 1;
        this._emit();
        return;
      }

      // Marcar primer inicio
      if (next.firstStart === null) next.firstStart = this.time;

      // Ejecutar 1 unidad
      next.remaining -= 1;
      next.executed += 1;
      this._appendSlice(next.id, 1);

      // finalizar o consumir quantum
      if (next.remaining === 0) {
        next.completion = this.time + 1;
        if (this.algo === "RR") this.rrQuantumLeft = this.quantum;
      } else if (this.algo === "RR") {
        this.rrQuantumLeft -= 1;
      }

      this.current = next.id;
      this.time += 1;
      this._emit();
    }

    _appendSlice(pid, len) {
      if (len <= 0) return;
      const last = this.timeline[this.timeline.length - 1];
      if (last && last.pid === pid && last.end === this.time) {
        last.end += len;
      } else {
        this.timeline.push({ pid, start: this.time, end: this.time + len });
      }
    }
  }

  function computeResults(stats) {
    const rows = stats.map(p => {
      const turnaround = p.completion != null ? p.completion - p.arrival : null;
      const waiting = turnaround != null ? turnaround - p.burst : null;
      const response = p.firstStart != null ? p.firstStart - p.arrival : null;
      const efficiency = turnaround && turnaround > 0 ? +(p.burst / turnaround).toFixed(3) : null;
      return { ...p, turnaround, waiting, response, efficiency };
    });
    const best = rows.reduce((acc, r) => {
      const sc = r.efficiency ?? -1;
      return sc > acc.score ? { id: r.id, score: sc } : acc;
    }, { id: null, score: -1 }).id;

    const avg = arr => +(arr.reduce((a, b) => a + (b ?? 0), 0) / (arr.length || 1)).toFixed(3);
    const avgs = {
      turnaround: avg(rows.map(r => r.turnaround)),
      waiting:    avg(rows.map(r => r.waiting)),
      response:   avg(rows.map(r => r.response)),
      efficiency: avg(rows.map(r => r.efficiency)),
    };
    return { rows, avgs, best };
  }

  // API pública
  const Scheduler = {
    createSimulator(processes, opts) { return new Simulator(processes, opts); },
    colors: COLORS,
  };

  // Exponer globalmente
  global.Scheduler = Scheduler;
})(window);
