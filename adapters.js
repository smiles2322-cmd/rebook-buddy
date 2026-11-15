/* Rebook Buddy flight data adapters.
 * Every adapter implements:
 *   name: string, isDemo: boolean
 *   searchAlternatives(flight) -> Promise<Array<Option>>
 *   Option = { id, airline, number, from, to, depart (ISO), arrive (ISO), stops, via, seats, partner (bool), note }
 * To plug in a real provider later, write an adapter with the same shape that calls
 * your own backend (never put API keys in this file) and register it:
 *   RB.adapters.register('myapi', MyAdapter); RB.adapters.use('myapi');
 */
(function () {
  const AIRLINES = [
    { name: 'Harborline Air', code: 'HL', phone: '(312) 555-0142', partner: 'Cedarwing Airlines' },
    { name: 'Cedarwing Airlines', code: 'CW', phone: '(206) 555-0177', partner: 'Harborline Air' },
    { name: 'Lumen Pacific', code: 'LP', phone: '(415) 555-0123', partner: 'Northgate Air' },
    { name: 'Northgate Air', code: 'NG', phone: '(612) 555-0168', partner: 'Lumen Pacific' }
  ];
  const AIRPORTS = {
    ATL: 'Atlanta', BOS: 'Boston', DEN: 'Denver', DFW: 'Dallas', JFK: 'New York', LAX: 'Los Angeles',
    LAS: 'Las Vegas', MCO: 'Orlando', MIA: 'Miami', MSP: 'Minneapolis', ORD: 'Chicago', PHX: 'Phoenix',
    SEA: 'Seattle', SFO: 'San Francisco', STL: 'St. Louis', MSY: 'New Orleans', AUS: 'Austin', BNA: 'Nashville'
  };
  const HUBS = ['DEN', 'DFW', 'MSP', 'ATL', 'PHX'];

  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
  function code(s) { return String(s || '').trim().toUpperCase().slice(0, 3); }

  const DemoAdapter = {
    name: 'Built-in example data',
    isDemo: true,
    async searchAlternatives(f) {
      const from = code(f.from) || 'ORD', to = code(f.to) || 'SEA';
      const al = AIRLINES.find(a => a.name.toLowerCase() === String(f.airline || '').toLowerCase()) || AIRLINES[0];
      const partner = AIRLINES.find(a => a.name === al.partner) || AIRLINES[1];
      const r = rng(hash(from + to + (f.number || '') + (f.date || '')));
      const base = new Date(`${f.date || new Date().toISOString().slice(0, 10)}T${f.dep || '18:00'}:00`);
      const dur = 150 + Math.floor(r() * 150);
      const hub = HUBS.find(h => h !== from && h !== to) || 'DEN';
      const mk = (id, airline, cd, addMin, durMin, extra) => {
        const d = new Date(base.getTime() + addMin * 60000), a = new Date(d.getTime() + durMin * 60000);
        return Object.assign({ id, airline, number: `${cd} ${100 + Math.floor(r() * 899)}`, from, to, depart: d.toISOString(), arrive: a.toISOString(), stops: 0, via: '', seats: 1 + Math.floor(r() * 9), partner: false, note: '' }, extra);
      };
      await new Promise(res => setTimeout(res, 250));
      return [
        mk('a1', al.name, al.code, 140 + Math.floor(r() * 60), dur, { seats: 2, note: 'Same airline, tonight. Few seats, ask fast.' }),
        mk('a2', partner.name, partner.code, 95 + Math.floor(r() * 40), dur + 10, { partner: true, note: 'Partner airline. Ask the agent to rebook you on it.' }),
        mk('a3', al.name, al.code, 60 + Math.floor(r() * 30), dur + 95, { stops: 1, via: hub, note: `Connects in ${hub}. Gets you there tonight.` }),
        mk('a4', al.name, al.code, 14 * 60 + Math.floor(r() * 60), dur, { seats: 12, note: 'First flight tomorrow morning. Plenty of seats.' })
      ];
    }
  };

  const registry = { demo: DemoAdapter };
  let current = 'demo';
  window.RB = window.RB || {};
  window.RB.data = { AIRLINES, AIRPORTS };
  window.RB.adapters = {
    register(key, adapter) { registry[key] = adapter; },
    use(key) { if (registry[key]) current = key; },
    get active() { return registry[current]; }
  };
})();
