import React, { useState, useMemo } from 'react';
import { Home, Calendar, Clock, Settings, Plus, Edit2, Trash2, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, RotateCw, AlertCircle } from 'lucide-react';
import { format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday } from 'date-fns';
import { nb } from 'date-fns/locale';

// --- TYPES ---
interface Job {
  id: string;
  navn: string;
  lonn: number;
  feriesats: number;
  deleted?: boolean;
}

interface Shift {
  id: string;
  jobId: string;
  dato: string;
  start: string;
  slutt: string;
  status: 'Kommende' | 'Fullfort';
}

interface AppData {
  jobs: Job[];
  shifts: Shift[];
}

// --- UTILS ---
const calculateHours = (start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let hours = (eh + em / 60) - (sh + sm / 60);
  if (hours < 0) hours += 24; // Crosses midnight
  return hours;
};

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('no-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(val);
};

// --- INITIAL DATA LOAD ---
const loadData = (): AppData => {
  try {
    const savedJobs = localStorage.getItem('myJobs');
    const savedShifts = localStorage.getItem('myShifts');
    
    let jobs: Job[] = savedJobs ? JSON.parse(savedJobs) : [
      { id: "1", navn: "Hovedjobb", lonn: 190.00, feriesats: 0.10 }
    ];
    let shifts: Shift[] = savedShifts ? JSON.parse(savedShifts) : [];

    jobs = jobs.map(j => ({ ...j, id: String(j.id) }));
    shifts = shifts.map(s => ({ ...s, id: String(s.id), jobId: String(s.jobId) }));

    return { jobs, shifts };
  } catch (e) {
    return { jobs: [], shifts: [] };
  }
};

export default function App() {
  // --- STATE: HISTORY & DATA ---
  const [history, setHistory] = useState<AppData[]>([loadData()]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vakter' | 'kalender' | 'innstillinger'>('dashboard');

  const currentData = history[currentIndex];

  const updateData = (newData: AppData) => {
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(newData);
    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
    localStorage.setItem('myJobs', JSON.stringify(newData.jobs));
    localStorage.setItem('myShifts', JSON.stringify(newData.shifts));
  };

  const undo = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      localStorage.setItem('myJobs', JSON.stringify(history[newIndex].jobs));
      localStorage.setItem('myShifts', JSON.stringify(history[newIndex].shifts));
    }
  };

  const redo = () => {
    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      localStorage.setItem('myJobs', JSON.stringify(history[newIndex].jobs));
      localStorage.setItem('myShifts', JSON.stringify(history[newIndex].shifts));
    }
  };

  return (
    <div className="min-h-screen bg-black pb-24 font-sans flex flex-col items-center text-white">
      
      {/* HEADER (iOS Style) */}
      <div className="sticky top-0 z-50 w-full max-w-md ios-blur border-b border-[#2c2c2e] px-4 py-3 flex justify-between items-center">
        <h1 className="text-xl font-semibold tracking-tight text-white">
          {activeTab === 'dashboard' && 'Oversikt'}
          {activeTab === 'vakter' && 'Vakter & Logg'}
          {activeTab === 'kalender' && 'Kalender'}
          {activeTab === 'innstillinger' && 'Innstillinger'}
        </h1>
        <div className="flex gap-3">
          <button onClick={undo} disabled={currentIndex === 0} className={`p-2 rounded-full transition-colors ${currentIndex === 0 ? 'text-gray-700' : 'text-blue-500 hover:bg-[#2c2c2e]'}`}>
            <RotateCcw size={20} />
          </button>
          <button onClick={redo} disabled={currentIndex === history.length - 1} className={`p-2 rounded-full transition-colors ${currentIndex === history.length - 1 ? 'text-gray-700' : 'text-blue-500 hover:bg-[#2c2c2e]'}`}>
            <RotateCw size={20} />
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <main className="w-full max-w-md px-4 py-6 flex-1 flex flex-col gap-6">
        {activeTab === 'dashboard' && <Dashboard data={currentData} />}
        {activeTab === 'vakter' && <VakterTab data={currentData} onUpdate={updateData} />}
        {activeTab === 'kalender' && <KalenderTab data={currentData} />}
        {activeTab === 'innstillinger' && <InnstillingerTab data={currentData} onUpdate={updateData} />}
      </main>

      {/* BOTTOM TAB BAR */}
      <div className="fixed bottom-0 left-0 right-0 ios-blur border-t border-[#2c2c2e] flex justify-center pb-8 pt-2 px-2">
        <nav className="w-full max-w-md flex justify-around">
          <TabButton icon={<Home />} label="Oversikt" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <TabButton icon={<Clock />} label="Vakter" active={activeTab === 'vakter'} onClick={() => setActiveTab('vakter')} />
          <TabButton icon={<Calendar />} label="Kalender" active={activeTab === 'kalender'} onClick={() => setActiveTab('kalender')} />
          <TabButton icon={<Settings />} label="Mer" active={activeTab === 'innstillinger'} onClick={() => setActiveTab('innstillinger')} />
        </nav>
      </div>

    </div>
  );
}

// --- TAB BUTTON ---
function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-full py-2 gap-1 transition-colors ${active ? 'text-blue-500' : 'text-gray-500'}`}
    >
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform duration-200`}>
        {React.cloneElement(icon as React.ReactElement, { size: 24, strokeWidth: active ? 2.5 : 2 })}
      </div>
      <span className="text-[10px] font-medium mt-0.5">{label}</span>
    </button>
  );
}

// --- DASHBOARD COMPONENT ---
function Dashboard({ data }: { data: AppData }) {
  const iDagStr = new Date().toISOString().split('T')[0];
  const sortedShifts = [...data.shifts].sort((a,b) => new Date(a.dato).getTime() - new Date(b.dato).getTime());
  
  let nextShift = sortedShifts.find(s => s.status === 'Kommende' && s.dato >= iDagStr);
  
  // Calculate stats per month
  const monthlyStats = useMemo(() => {
    const stats: Record<string, { monthDate: Date, totalLonn: number, totalFerie: number, hours: number }> = {};

    sortedShifts.filter(s => s.status === 'Fullfort').forEach(s => {
      const monthKey = s.dato.substring(0, 7); // "YYYY-MM"
      if (!stats[monthKey]) {
        stats[monthKey] = {
          monthDate: parseISO(`${monthKey}-01`),
          totalLonn: 0,
          totalFerie: 0,
          hours: 0
        };
      }
      const j = data.jobs.find(j => j.id === s.jobId);
      if (j) {
        const h = calculateHours(s.start, s.slutt);
        const brutto = h * j.lonn;
        stats[monthKey].totalLonn += brutto;
        stats[monthKey].totalFerie += brutto * j.feriesats;
        stats[monthKey].hours += h;
      }
    });

    return Object.values(stats).sort((a, b) => b.monthDate.getTime() - a.monthDate.getTime());
  }, [sortedShifts, data.jobs]);

  const currentMonthKey = iDagStr.substring(0, 7);
  const currentMonthData = monthlyStats.find(s => format(s.monthDate, 'yyyy-MM') === currentMonthKey) || { totalLonn: 0, totalFerie: 0, hours: 0 };

  let allTimeLonn = 0;
  let allTimeFerie = 0;
  monthlyStats.forEach(m => {
    allTimeLonn += m.totalLonn;
    allTimeFerie += m.totalFerie;
  });

  return (
    <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Current Month Highlight */}
      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Denne måneden</h2>
        <div className="text-5xl font-bold text-white mb-2 tracking-tight">{formatCurrency(currentMonthData.totalLonn)}</div>
        <p className="text-sm text-gray-500 font-medium">
          Opptjent på {currentMonthData.hours.toFixed(1)} timer 
          <span className="text-blue-400 ml-2">+{formatCurrency(currentMonthData.totalFerie)} i feriepenger</span>
        </p>
      </div>

      {/* All Time Highlight */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Lønn i år</h3>
          <p className="text-2xl font-bold text-white tracking-tight">{formatCurrency(allTimeLonn)}</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Feriepenger</h3>
          <p className="text-2xl font-bold text-blue-500 tracking-tight">{formatCurrency(allTimeFerie)}</p>
        </div>
      </div>

      {/* Next Shift */}
      <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow mt-2">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Calendar size={20} className="text-blue-500" /> Neste vakt
        </h2>
        {nextShift ? (() => {
          const job = data.jobs.find(j => j.id === nextShift.jobId);
          const hours = calculateHours(nextShift.start, nextShift.slutt);
          return (
            <div className="flex justify-between items-center bg-[#2c2c2e] p-4 rounded-2xl">
              <div>
                <h4 className="font-semibold text-blue-300 text-lg">{job?.navn || 'Ukjent jobb'}</h4>
                <p className="text-white font-medium capitalize mt-1">{format(parseISO(nextShift.dato), 'EEEE d. MMM', { locale: nb })}</p>
                <p className="text-sm text-gray-400 mt-1">{nextShift.start} - {nextShift.slutt} <span className="ml-1 px-1.5 py-0.5 bg-[#3a3a3c] rounded text-xs text-gray-300">{hours.toFixed(1)}t</span></p>
              </div>
            </div>
          )
        })() : (
          <p className="text-gray-500 text-sm">Du har ingen kommende vakter planlagt.</p>
        )}
      </div>

      {/* Monthly Log */}
      {monthlyStats.length > 0 && (
        <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow mt-2">
          <h2 className="text-lg font-bold text-white mb-5">Månedlig Logg</h2>
          <div className="flex flex-col gap-5">
            {monthlyStats.map(stat => (
              <div key={stat.monthDate.toISOString()} className="flex justify-between items-center border-b border-[#2c2c2e] pb-5 last:border-0 last:pb-0">
                <div>
                  <h4 className="font-semibold text-white capitalize text-base tracking-wide">{format(stat.monthDate, 'MMMM yyyy', { locale: nb })}</h4>
                  <p className="text-sm text-gray-400 mt-1 font-medium">{stat.hours.toFixed(1)} timer jobbet</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white text-lg tracking-tight">{formatCurrency(stat.totalLonn)}</p>
                  <p className="text-xs font-semibold text-blue-400 mt-1">+{formatCurrency(stat.totalFerie)} ferie</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// --- VAKTER TAB (LIST + FORM) ---
function VakterTab({ data, onUpdate }: { data: AppData, onUpdate: (d: AppData) => void }) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const activeJobs = data.jobs.filter(j => !j.deleted);

  const [formData, setFormData] = useState({
    jobId: activeJobs[0]?.id || '',
    dato: new Date().toISOString().split('T')[0],
    start: '22:00',
    slutt: '03:00',
    status: 'Kommende' as 'Kommende' | 'Fullfort'
  });

  const handleEditClick = (shift: Shift) => {
    setIsEditing(shift.id);
    setFormData({
      jobId: shift.jobId,
      dato: shift.dato,
      start: shift.start,
      slutt: shift.slutt,
      status: shift.status
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!formData.jobId) return setErrorMsg('Velg en jobb først!');

    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

    if (formData.status === 'Fullfort' && formData.dato > iDagStr) {
      return setErrorMsg("Feil: Du kan ikke logge en jobb som 'Fullført' hvis datoen er frem i tid!");
    }
    if (formData.status === 'Kommende' && formData.dato < iDagStr) {
      return setErrorMsg("Feil: Datoen er i fortiden. Sett status til 'Fullført'.");
    }

    if (isEditing) {
      onUpdate({
        ...data,
        shifts: data.shifts.map(s => s.id === isEditing ? { ...s, ...formData } : s)
      });
      setIsEditing(null);
    } else {
      onUpdate({
        ...data,
        shifts: [{ id: Date.now().toString(), ...formData }, ...data.shifts]
      });
    }
    
    // Reset but keep defaults (22:00 - 03:00)
    setFormData(prev => ({ ...prev, start: '22:00', slutt: '03:00' }));
  };

  const handleDelete = (id: string) => {
    onUpdate({ ...data, shifts: data.shifts.filter(s => s.id !== id) });
    setErrorMsg(null);
  };

  const handleComplete = (id: string) => {
    const shift = data.shifts.find(s => s.id === id);
    if (!shift) return;
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
    if (shift.dato > iDagStr) {
      return setErrorMsg("Du kan ikke godkjenne denne vakten ennå fordi datoen er i fremtiden.");
    }
    onUpdate({
      ...data,
      shifts: data.shifts.map(s => s.id === id ? { ...s, status: 'Fullfort' } : s)
    });
    setErrorMsg(null);
  };

  const sortedShifts = [...data.shifts].sort((a,b) => new Date(b.dato).getTime() - new Date(a.dato).getTime());

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* VAKT FORM */}
      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow border border-[#2c2c2e]">
        <h2 className="text-xl font-bold text-white mb-5 flex justify-between items-center tracking-tight">
          <span>{isEditing ? 'Rediger vakt' : 'Ny Vakt'}</span>
          {isEditing && (
             <button onClick={() => setIsEditing(null)} className="text-sm text-blue-500 font-semibold px-3 py-1 bg-[#2c2c2e] rounded-full">Avbryt</button>
          )}
        </h2>
        
        {activeJobs.length === 0 ? (
          <div className="bg-orange-900/30 text-orange-400 p-4 rounded-xl text-sm flex gap-2 border border-orange-500/20">
            <AlertCircle size={20} className="shrink-0" />
            Du må legge til en jobb (under Innstillinger) før du kan logge vakter.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {errorMsg && (
              <div className="bg-red-900/30 text-red-400 p-3 rounded-xl text-sm flex items-center justify-between border border-red-500/20">
                <div className="flex gap-2 items-center">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                <button type="button" onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-300 ml-2">✕</button>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Jobb</label>
              <select 
                value={formData.jobId} onChange={e => setFormData({...formData, jobId: e.target.value})}
                className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                {activeJobs.map(j => <option key={j.id} value={j.id}>{j.navn}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Dato</label>
              <input type="date" value={formData.dato} onChange={e => setFormData({...formData, dato: e.target.value})} required className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Start</label>
                <input type="time" value={formData.start} onChange={e => setFormData({...formData, start: e.target.value})} required className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Slutt</label>
                <input type="time" value={formData.slutt} onChange={e => setFormData({...formData, slutt: e.target.value})} required className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
              </div>
            </div>

            <div className="mt-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</label>
              <div className="flex gap-2 bg-[#000000] p-1 rounded-2xl border border-[#2c2c2e]">
                <button type="button" onClick={() => setFormData({...formData, status: 'Kommende'})} className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${formData.status === 'Kommende' ? 'bg-[#2c2c2e] shadow-sm text-white' : 'text-gray-500'}`}>Kommende</button>
                <button type="button" onClick={() => setFormData({...formData, status: 'Fullfort'})} className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${formData.status === 'Fullfort' ? 'bg-[#2c2c2e] shadow-sm text-white' : 'text-gray-500'}`}>Fullført</button>
              </div>
            </div>

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg py-4 rounded-2xl mt-4 transition-colors active:scale-[0.98]">
              {isEditing ? 'Lagre Endringer' : 'Legg Til Vakt'}
            </button>
          </form>
        )}
      </div>

      {/* VAKT LISTE */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xl font-bold text-white ml-2 tracking-tight">Dine vakter</h3>
        {sortedShifts.length === 0 ? (
          <div className="bg-[#1c1c1e] rounded-3xl p-8 text-center text-gray-500 font-medium">Ingen vakter logget ennå.</div>
        ) : (
          sortedShifts.map(s => {
            const job = data.jobs.find(j => j.id === s.jobId);
            const hours = calculateHours(s.start, s.slutt);
            return (
              <div key={s.id} className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-lg">{job?.navn || 'Slettet jobb'}</h4>
                    <p className="text-sm text-gray-400 capitalize mt-1 font-medium">{format(parseISO(s.dato), 'EEEE d. MMM yyyy', { locale: nb })}</p>
                  </div>
                  <div className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-widest ${s.status === 'Kommende' ? 'bg-orange-900/40 text-orange-400' : 'bg-green-900/40 text-green-400'}`}>
                    {s.status}
                  </div>
                </div>
                
                <div className="flex justify-between items-center text-sm font-medium bg-[#2c2c2e] px-4 py-3 rounded-2xl">
                  <span className="text-white tracking-wide">{s.start} - {s.slutt}</span>
                  <span className="text-gray-400">{hours.toFixed(1)} timer</span>
                </div>

                <div className="flex justify-end gap-2 mt-1">
                  {s.status === 'Kommende' && (
                    <button onClick={() => handleComplete(s.id)} className="flex items-center gap-1.5 px-4 py-2 bg-green-900/30 text-green-400 hover:bg-green-900/50 rounded-xl text-sm font-bold transition-colors">
                      <CheckCircle2 size={16} strokeWidth={2.5} /> Ferdig
                    </button>
                  )}
                  <button onClick={() => handleEditClick(s)} className="flex items-center gap-1.5 px-4 py-2 bg-[#2c2c2e] text-blue-400 hover:bg-[#38383a] rounded-xl text-sm font-bold transition-colors">
                    <Edit2 size={16} strokeWidth={2.5} /> Endre
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="flex items-center gap-1.5 px-4 py-2 bg-[#2c2c2e] text-red-400 hover:bg-[#38383a] rounded-xl text-sm font-bold transition-colors">
                    <Trash2 size={16} strokeWidth={2.5} /> Slett
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- KALENDER TAB ---
function KalenderTab({ data }: { data: AppData }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const firstDayOfWeek = getDay(startOfMonth(currentMonth)) || 7; // 1=Mon...7=Sun
  const prefixDays = Array.from({ length: firstDayOfWeek - 1 });

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
        
        {/* Kalender Header */}
        <div className="flex justify-between items-center mb-6 px-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 text-blue-500 hover:bg-[#2c2c2e] rounded-full transition-colors">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-xl font-bold text-white capitalize tracking-tight">
            {format(currentMonth, 'MMMM yyyy', { locale: nb })}
          </h2>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 text-blue-500 hover:bg-[#2c2c2e] rounded-full transition-colors">
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Days Header */}
        <div className="grid grid-cols-7 gap-1 mb-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">
          <div>Ma</div><div>Ti</div><div>On</div><div>To</div><div>Fr</div><div>Lø</div><div>Sø</div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-2">
          {prefixDays.map((_, i) => <div key={`empty-${i}`} className="h-14"></div>)}
          
          {daysInMonth.map(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const dayShifts = data.shifts.filter(s => s.dato === dateStr);
            const isTdy = isToday(date);
            
            return (
              <div key={date.toISOString()} className={`relative h-14 rounded-xl flex flex-col items-center justify-start pt-1.5 border-2 ${isTdy ? 'bg-blue-900/20 border-blue-500/50' : 'bg-[#2c2c2e] border-transparent'} overflow-hidden`}>
                <span className={`text-sm font-bold ${isTdy ? 'text-blue-400' : 'text-gray-200'}`}>{format(date, 'd')}</span>
                <div className="w-full px-1.5 flex flex-col gap-1 mt-1">
                  {dayShifts.map(s => {
                    const isDone = s.status === 'Fullfort';
                    return (
                      <div key={s.id} className={`h-1.5 w-full rounded-full ${isDone ? 'bg-green-500' : 'bg-orange-500'}`} title={s.start + '-' + s.slutt}></div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-6 mt-6 pt-5 border-t border-[#2c2c2e] justify-center text-xs text-gray-400 font-bold uppercase tracking-wider">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500"></div>Kommende</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500"></div>Fullført</div>
        </div>

      </div>
    </div>
  );
}

// --- INNSTILLINGER TAB ---
function InnstillingerTab({ data, onUpdate }: { data: AppData, onUpdate: (d: AppData) => void }) {
  const [newJob, setNewJob] = useState({ navn: '', lonn: '', ferie: '10' });
  const [importStatus, setImportStatus] = useState<{ type: 'success'|'error', msg: string } | null>(null);

  const activeJobs = data.jobs.filter(j => !j.deleted);

  const handleExport = () => {
    const backupData = JSON.stringify({
      myJobs: localStorage.getItem('myJobs'),
      myShifts: localStorage.getItem('myShifts')
    });
    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'min_vaktbok_backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (importedData.myJobs) localStorage.setItem('myJobs', importedData.myJobs);
        if (importedData.myShifts) localStorage.setItem('myShifts', importedData.myShifts);
        setImportStatus({ type: 'success', msg: 'Backup lastet inn! Last siden på nytt for å se endringene.' });
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        setImportStatus({ type: 'error', msg: 'Feil ved innlesing av fil. Sjekk at det er riktig JSON-fil.' });
      }
    };
    reader.readAsText(file);
  };

  const handleAddJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJob.navn || !newJob.lonn) return;
    const job: Job = {
      id: Date.now().toString(),
      navn: newJob.navn,
      lonn: parseFloat(newJob.lonn),
      feriesats: parseFloat(newJob.ferie) / 100
    };
    onUpdate({ ...data, jobs: [...data.jobs, job] });
    setNewJob({ navn: '', lonn: '', ferie: '10' });
  };

  const handleDeleteJob = (id: string) => {
    onUpdate({
      ...data,
      jobs: data.jobs.map(j => j.id === id ? { ...j, deleted: true } : j)
    });
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Active Jobs */}
      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow">
        <h2 className="text-xl font-bold text-white mb-5 tracking-tight">Dine Jobber</h2>
        {activeJobs.length === 0 ? (
          <p className="text-gray-500 text-sm mb-5 font-medium">Ingen jobber lagt til.</p>
        ) : (
          <div className="flex flex-col gap-3 mb-6">
            {activeJobs.map(j => (
              <div key={j.id} className="flex justify-between items-center bg-[#2c2c2e] p-4 rounded-2xl">
                <div>
                  <h3 className="font-bold text-white text-lg">{j.navn}</h3>
                  <p className="text-sm text-gray-400 font-medium mt-0.5">{j.lonn} kr/t • {j.feriesats * 100}% feriepenger</p>
                </div>
                <button onClick={() => handleDeleteJob(j.id)} className="p-3 text-red-400 hover:bg-[#38383a] rounded-xl transition-colors">
                  <Trash2 size={20} />
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="text-base font-bold text-white mb-4 border-t border-[#2c2c2e] pt-5">Legg til ny jobb</h3>
        <form onSubmit={handleAddJob} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Navn</label>
            <input type="text" value={newJob.navn} onChange={e => setNewJob({...newJob, navn: e.target.value})} required placeholder="F.eks. Rema 1000" className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Timelønn</label>
              <input type="number" step="0.5" value={newJob.lonn} onChange={e => setNewJob({...newJob, lonn: e.target.value})} required placeholder="190" className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ferie (%)</label>
              <input type="number" step="0.1" value={newJob.ferie} onChange={e => setNewJob({...newJob, ferie: e.target.value})} required className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <button type="submit" className="w-full bg-[#2c2c2e] text-blue-400 font-bold text-lg py-4 rounded-2xl mt-2 transition-colors hover:bg-[#38383a] active:scale-[0.98] flex items-center justify-center gap-2">
            <Plus size={20} strokeWidth={2.5} /> Legg Til Jobb
          </button>
        </form>
      </div>

      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow">
        <h2 className="text-xl font-bold text-white mb-5 tracking-tight">Backup & Data</h2>
        
        {importStatus && (
          <div className={`p-4 rounded-xl text-sm font-medium mb-4 flex gap-2 items-center ${importStatus.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-500/20' : 'bg-red-900/30 text-red-400 border border-red-500/20'}`}>
            <AlertCircle size={18} className="shrink-0" />
            {importStatus.msg}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button onClick={handleExport} className="w-full bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] active:scale-[0.98]">
            💾 Lagre Backup (Eksport)
          </button>
          <label className="w-full bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] active:scale-[0.98] text-center cursor-pointer block">
            📂 Last inn Backup (Import)
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
      </div>

    </div>
  );
}
