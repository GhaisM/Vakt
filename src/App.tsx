import React, { useState, useEffect, useMemo } from 'react';
import { Home, Calendar, Clock, Settings, Plus, Edit2, Trash2, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, RotateCw, AlertCircle } from 'lucide-react';
import { format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns';
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
      { id: "1", navn: "Hovedjobb", lonn: 190.00, feriesats: 0.102 },
      { id: "2", navn: "Deltidsprosjekt", lonn: 250.00, feriesats: 0.12 }
    ];
    let shifts: Shift[] = savedShifts ? JSON.parse(savedShifts) : [];

    // Ensure IDs are strings
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
    <div className="min-h-screen bg-[#f2f2f7] pb-24 font-sans flex flex-col items-center">
      
      {/* HEADER (iOS Style) */}
      <div className="sticky top-0 z-50 w-full max-w-md ios-blur border-b border-gray-200 px-4 py-3 flex justify-between items-center">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          {activeTab === 'dashboard' && 'Oversikt'}
          {activeTab === 'vakter' && 'Vakter & Logg'}
          {activeTab === 'kalender' && 'Kalender'}
          {activeTab === 'innstillinger' && 'Innstillinger'}
        </h1>
        <div className="flex gap-3">
          <button onClick={undo} disabled={currentIndex === 0} className={`p-2 rounded-full ${currentIndex === 0 ? 'text-gray-300' : 'text-blue-500 hover:bg-blue-50'}`}>
            <RotateCcw size={20} />
          </button>
          <button onClick={redo} disabled={currentIndex === history.length - 1} className={`p-2 rounded-full ${currentIndex === history.length - 1 ? 'text-gray-300' : 'text-blue-500 hover:bg-blue-50'}`}>
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
      <div className="fixed bottom-0 left-0 right-0 ios-blur border-t border-gray-200 flex justify-center pb-4">
        <nav className="w-full max-w-md flex justify-around px-2 py-2">
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
      className={`flex flex-col items-center justify-center w-full py-1 gap-1 transition-colors ${active ? 'text-blue-500' : 'text-gray-400'}`}
    >
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform duration-200`}>
        {React.cloneElement(icon as React.ReactElement, { size: 24, strokeWidth: active ? 2.5 : 2 })}
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// --- DASHBOARD COMPONENT ---
function Dashboard({ data }: { data: AppData }) {
  const iDagStr = new Date().toISOString().split('T')[0];
  const sortedShifts = [...data.shifts].sort((a,b) => new Date(a.dato).getTime() - new Date(b.dato).getTime());
  
  let nextShift = sortedShifts.find(s => s.status === 'Kommende' && s.dato >= iDagStr);
  let totalLonn = 0;
  let totalFerie = 0;
  
  const mndLonn = sortedShifts.filter(s => s.status === 'Fullfort' && s.dato.startsWith(iDagStr.substring(0,7))).reduce((sum, s) => {
    const j = data.jobs.find(j => j.id === s.jobId);
    if (!j) return sum;
    return sum + (calculateHours(s.start, s.slutt) * j.lonn);
  }, 0);

  sortedShifts.filter(s => s.status === 'Fullfort').forEach(s => {
    const j = data.jobs.find(j => j.id === s.jobId);
    if (j) {
      const brutto = calculateHours(s.start, s.slutt) * j.lonn;
      totalLonn += brutto;
      totalFerie += brutto * j.feriesats;
    }
  });

  return (
    <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-white rounded-2xl p-5 ios-shadow">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Denne måneden</h2>
        <div className="text-4xl font-bold text-gray-900 mb-1">{formatCurrency(mndLonn)}</div>
        <p className="text-sm text-gray-500">Opptjent via fullførte vakter</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-4 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Total Lønn</h3>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(totalLonn)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Feriepenger</h3>
          <p className="text-xl font-bold text-blue-500">{formatCurrency(totalFerie)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 ios-shadow mt-2">
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Calendar size={20} className="text-blue-500" /> Neste vakt
        </h2>
        {nextShift ? (() => {
          const job = data.jobs.find(j => j.id === nextShift.jobId);
          const hours = calculateHours(nextShift.start, nextShift.slutt);
          return (
            <div className="flex justify-between items-center bg-blue-50 p-4 rounded-xl">
              <div>
                <h4 className="font-semibold text-blue-900 text-lg">{job?.navn || 'Ukjent jobb'}</h4>
                <p className="text-blue-700 font-medium">{format(parseISO(nextShift.dato), 'EEEE d. MMM', { locale: nb })}</p>
                <p className="text-sm text-blue-600 mt-1">{nextShift.start} - {nextShift.slutt} ({hours.toFixed(1)}t)</p>
              </div>
            </div>
          )
        })() : (
          <p className="text-gray-500 text-sm">Du har ingen kommende vakter planlagt.</p>
        )}
      </div>
    </div>
  );
}

// --- VAKTER TAB (LIST + FORM) ---
function VakterTab({ data, onUpdate }: { data: AppData, onUpdate: (d: AppData) => void }) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  
  const activeJobs = data.jobs.filter(j => !j.deleted);

  const [formData, setFormData] = useState({
    jobId: activeJobs[0]?.id || '',
    dato: new Date().toISOString().split('T')[0],
    start: '08:00',
    slutt: '16:00',
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
    if (!formData.jobId) return alert('Velg en jobb først!');

    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

    if (formData.status === 'Fullfort' && formData.dato > iDagStr) {
      return alert("Feil: Du kan ikke logge en jobb som 'Fullført' hvis datoen er frem i tid!");
    }
    if (formData.status === 'Kommende' && formData.dato < iDagStr) {
      return alert("Feil: Datoen er i fortiden. Sett status til 'Fullført'.");
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
    
    // Reset but keep some defaults
    setFormData(prev => ({ ...prev, start: '08:00', slutt: '16:00' }));
  };

  const handleDelete = (id: string) => {
    if (confirm("Er du sikker på at du vil slette denne vakten?")) {
      onUpdate({ ...data, shifts: data.shifts.filter(s => s.id !== id) });
    }
  };

  const handleComplete = (id: string) => {
    const shift = data.shifts.find(s => s.id === id);
    if (!shift) return;
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
    if (shift.dato > iDagStr) {
      return alert("Vent litt! Du kan ikke godkjenne denne vakten ennå fordi datoen er i fremtiden.");
    }
    onUpdate({
      ...data,
      shifts: data.shifts.map(s => s.id === id ? { ...s, status: 'Fullfort' } : s)
    });
  };

  const sortedShifts = [...data.shifts].sort((a,b) => new Date(b.dato).getTime() - new Date(a.dato).getTime());

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* VAKT FORM */}
      <div className="bg-white rounded-2xl p-5 ios-shadow border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex justify-between items-center">
          <span>{isEditing ? 'Rediger vakt' : 'Ny Vakt'}</span>
          {isEditing && (
             <button onClick={() => setIsEditing(null)} className="text-sm text-blue-500 font-medium">Avbryt</button>
          )}
        </h2>
        
        {activeJobs.length === 0 ? (
          <div className="bg-orange-50 text-orange-800 p-4 rounded-xl text-sm flex gap-2">
            <AlertCircle size={20} className="shrink-0" />
            Du må legge til en arbeidsgiver (under Innstillinger) før du kan logge vakter.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Arbeidsgiver</label>
              <select 
                value={formData.jobId} onChange={e => setFormData({...formData, jobId: e.target.value})}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {activeJobs.map(j => <option key={j.id} value={j.id}>{j.navn}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Dato</label>
              <input type="date" value={formData.dato} onChange={e => setFormData({...formData, dato: e.target.value})} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Start</label>
                <input type="time" value={formData.start} onChange={e => setFormData({...formData, start: e.target.value})} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Slutt</label>
                <input type="time" value={formData.slutt} onChange={e => setFormData({...formData, slutt: e.target.value})} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Status</label>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
                <button type="button" onClick={() => setFormData({...formData, status: 'Kommende'})} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${formData.status === 'Kommende' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>Kommende</button>
                <button type="button" onClick={() => setFormData({...formData, status: 'Fullfort'})} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${formData.status === 'Fullfort' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>Fullført</button>
              </div>
            </div>

            <button type="submit" className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-xl mt-2 transition-colors active:scale-[0.98]">
              {isEditing ? 'Lagre Endringer' : 'Legg Til Vakt'}
            </button>
          </form>
        )}
      </div>

      {/* VAKT LISTE */}
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-gray-900 ml-1">Dine vakter</h3>
        {sortedShifts.length === 0 ? (
          <p className="text-gray-500 text-center py-6">Ingen vakter logget ennå.</p>
        ) : (
          sortedShifts.map(s => {
            const job = data.jobs.find(j => j.id === s.jobId);
            const hours = calculateHours(s.start, s.slutt);
            return (
              <div key={s.id} className="bg-white rounded-2xl p-4 ios-shadow flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900 text-base">{job?.navn || 'Slettet jobb'}</h4>
                    <p className="text-sm text-gray-500 capitalize">{format(parseISO(s.dato), 'EEEE d. MMM yyyy', { locale: nb })}</p>
                  </div>
                  <div className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${s.status === 'Kommende' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                    {s.status}
                  </div>
                </div>
                
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="bg-gray-100 px-3 py-1.5 rounded-lg text-gray-800">{s.start} - {s.slutt}</span>
                  <span className="text-gray-500">{hours.toFixed(1)} timer</span>
                </div>

                <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-gray-100">
                  {s.status === 'Kommende' && (
                    <button onClick={() => handleComplete(s.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-sm font-medium transition-colors">
                      <CheckCircle2 size={16} /> Ferdig
                    </button>
                  )}
                  <button onClick={() => handleEditClick(s)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-blue-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors">
                    <Edit2 size={16} /> Endre
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-red-500 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors">
                    <Trash2 size={16} /> Slett
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
      <div className="bg-white rounded-2xl p-4 ios-shadow">
        
        {/* Kalender Header */}
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 text-blue-500 hover:bg-blue-50 rounded-full">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-lg font-bold text-gray-900 capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: nb })}
          </h2>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 text-blue-500 hover:bg-blue-50 rounded-full">
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Days Header */}
        <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-semibold text-gray-400 uppercase">
          <div>Ma</div><div>Ti</div><div>On</div><div>To</div><div>Fr</div><div>Lø</div><div>Sø</div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-1">
          {prefixDays.map((_, i) => <div key={`empty-${i}`} className="h-14"></div>)}
          
          {daysInMonth.map(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const dayShifts = data.shifts.filter(s => s.dato === dateStr);
            const isTdy = isToday(date);
            
            return (
              <div key={date.toISOString()} className={`relative h-14 rounded-lg flex flex-col items-center justify-start pt-1 border border-transparent ${isTdy ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'} overflow-hidden`}>
                <span className={`text-xs font-medium ${isTdy ? 'text-blue-600' : 'text-gray-700'}`}>{format(date, 'd')}</span>
                <div className="w-full px-1 flex flex-col gap-0.5 mt-0.5">
                  {dayShifts.map(s => {
                    const isDone = s.status === 'Fullfort';
                    return (
                      <div key={s.id} className={`h-1.5 w-full rounded-full ${isDone ? 'bg-green-400' : 'bg-orange-400'}`} title={s.start + '-' + s.slutt}></div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-4 mt-4 pt-4 border-t border-gray-100 justify-center text-xs text-gray-500 font-medium">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-orange-400"></div>Kommende</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>Fullført</div>
        </div>

      </div>
    </div>
  );
}

// --- INNSTILLINGER TAB ---
function InnstillingerTab({ data, onUpdate }: { data: AppData, onUpdate: (d: AppData) => void }) {
  const [newJob, setNewJob] = useState({ navn: '', lonn: '', ferie: '10.2' });

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
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (importedData.myJobs) localStorage.setItem('myJobs', importedData.myJobs);
        if (importedData.myShifts) localStorage.setItem('myShifts', importedData.myShifts);
        alert("Backup lastet inn! Siden oppdateres nå.");
        window.location.reload();
      } catch (err) {
        alert("Feil ved innlesing av fil.");
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
    setNewJob({ navn: '', lonn: '', ferie: '10.2' });
  };

  const handleDeleteJob = (id: string) => {
    if (confirm("Er du sikker? Historikk fra denne jobben vil bevares på gamle vakter, men du kan ikke lenger logge nye vakter på den.")) {
      onUpdate({
        ...data,
        jobs: data.jobs.map(j => j.id === id ? { ...j, deleted: true } : j)
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Active Jobs */}
      <div className="bg-white rounded-2xl p-5 ios-shadow">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Dine Arbeidsgivere</h2>
        {activeJobs.length === 0 ? (
          <p className="text-gray-500 text-sm mb-4">Ingen arbeidsgivere lagt til.</p>
        ) : (
          <div className="flex flex-col gap-3 mb-6">
            {activeJobs.map(j => (
              <div key={j.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl">
                <div>
                  <h3 className="font-semibold text-gray-900">{j.navn}</h3>
                  <p className="text-sm text-gray-500">{j.lonn} kr/t • {j.feriesats * 100}% feriepenger</p>
                </div>
                <button onClick={() => handleDeleteJob(j.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="text-base font-semibold text-gray-900 mb-3 border-t border-gray-100 pt-4">Legg til ny jobb</h3>
        <form onSubmit={handleAddJob} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Navn</label>
            <input type="text" value={newJob.navn} onChange={e => setNewJob({...newJob, navn: e.target.value})} required placeholder="F.eks. Rema 1000" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Timelønn</label>
              <input type="number" step="0.5" value={newJob.lonn} onChange={e => setNewJob({...newJob, lonn: e.target.value})} required placeholder="190" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Ferie (%)</label>
              <input type="number" step="0.1" value={newJob.ferie} onChange={e => setNewJob({...newJob, ferie: e.target.value})} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-50 text-blue-600 font-semibold py-3 rounded-xl mt-1 transition-colors hover:bg-blue-100 active:scale-[0.98]">
            <Plus size={18} className="inline mr-1" /> Legg Til Jobb
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl p-5 ios-shadow">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Backup & Data</h2>
        <div className="flex flex-col gap-3">
          <button onClick={handleExport} className="w-full bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-100 active:scale-[0.98]">
            💾 Lagre Backup (Eksport)
          </button>
          <label className="w-full bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-100 active:scale-[0.98] text-center cursor-pointer">
            📂 Last inn Backup (Import)
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
      </div>

    </div>
  );
}
