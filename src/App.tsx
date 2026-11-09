import React, { useState, useMemo, useEffect } from 'react';
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
  pauseMin?: number;
  tilleggNok?: number;
}

interface AppData {
  jobs: Job[];
  shifts: Shift[];
}

interface BackupFile {
  format?: string;
  version?: number;
  exportedAt?: string;
  jobs: Job[];
  shifts: Shift[];
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface LastShiftDefaults {
  jobId?: string;
  start?: string;
  slutt?: string;
  pauseMin?: number;
  tilleggNok?: number;
}

const AUTO_BACKUP_KEY = 'myVaktbokRecovery';

// --- UTILS ---
const calculateHours = (start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let hours = (eh + em / 60) - (sh + sm / 60);
  if (hours < 0) hours += 24; // Crosses midnight
  return hours;
};

const today = () => format(new Date(), 'yyyy-MM-dd');

const calculatePaidHours = (shift: Pick<Shift, 'start' | 'slutt' | 'pauseMin'>) =>
  Math.max(0, calculateHours(shift.start, shift.slutt) - Math.max(0, Number(shift.pauseMin) || 0) / 60);

const estimateShiftPay = (shift: Shift, job?: Job) =>
  job ? calculatePaidHours(shift) * job.lonn + Math.max(0, Number(shift.tilleggNok) || 0) : 0;

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

const loadRecoveryBackup = (): { savedAt: string; jobs: Job[]; shifts: Shift[] } | null => {
  try {
    const value = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!value) return null;
    const backup = JSON.parse(value);
    if (typeof backup.savedAt !== 'string' || !Array.isArray(backup.jobs) || !Array.isArray(backup.shifts)) return null;
    return backup;
  } catch {
    return null;
  }
};

export default function App() {
  // --- STATE: HISTORY & DATA ---
  const [history, setHistory] = useState<AppData[]>([loadData()]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vakter' | 'kalender' | 'innstillinger'>('dashboard');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dateForShiftLog, setDateForShiftLog] = useState<string | undefined>();

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') setInstallPrompt(null);
  };

  const currentData = history[currentIndex];

  const updateData = (newData: AppData) => {
    try {
      localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        jobs: currentData.jobs,
        shifts: currentData.shifts
      }));
    } catch {
      // Keep normal editing available if browser storage is full.
    }
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
          <button aria-label="Angre siste endring" onClick={undo} disabled={currentIndex === 0} className={`p-2 rounded-full transition-colors ${currentIndex === 0 ? 'text-gray-700' : 'text-blue-500 hover:bg-[#2c2c2e]'}`}>
            <RotateCcw size={20} />
          </button>
          <button aria-label="Gjør om siste endring" onClick={redo} disabled={currentIndex === history.length - 1} className={`p-2 rounded-full transition-colors ${currentIndex === history.length - 1 ? 'text-gray-700' : 'text-blue-500 hover:bg-[#2c2c2e]'}`}>
            <RotateCw size={20} />
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <main className="w-full max-w-md px-4 py-6 pb-32 flex-1 flex flex-col gap-6">
        {activeTab === 'dashboard' && <Dashboard data={currentData} onOpenShiftLog={() => setActiveTab('vakter')} />}
        {activeTab === 'vakter' && <VakterTab data={currentData} onUpdate={updateData} initialDate={dateForShiftLog} onInitialDateApplied={() => setDateForShiftLog(undefined)} />}
        {activeTab === 'kalender' && <KalenderTab data={currentData} onOpenDate={(date) => { setDateForShiftLog(date); setActiveTab('vakter'); }} />}
        {activeTab === 'innstillinger' && <InnstillingerTab data={currentData} onUpdate={updateData} installPromptAvailable={Boolean(installPrompt)} isInstalled={isInstalled} onInstall={installApp} />}
      </main>

      {/* BOTTOM TAB BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#111318]/95 backdrop-blur-xl border-t border-[#2c2c2e] flex justify-center pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 px-2">
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
      type="button"
      aria-pressed={active}
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
function Dashboard({ data, onOpenShiftLog }: { data: AppData, onOpenShiftLog: () => void }) {
  const iDagStr = today();
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
        const h = calculatePaidHours(s);
        const brutto = estimateShiftPay(s, j);
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
      <button
        onClick={onOpenShiftLog}
        className="w-full min-h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] px-5 py-4 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-950/30 transition"
      >
        <Plus size={20} strokeWidth={2.5} /> Logg vakt
      </button>

      {/* Current Month Highlight */}
      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Lønn denne måneden · estimat</h2>
        <div className="text-5xl font-bold text-white mb-2 tracking-tight">{formatCurrency(currentMonthData.totalLonn)}</div>
        <p className="text-sm text-gray-500 font-medium">
          Registrert arbeid på {currentMonthData.hours.toFixed(1)} timer 
          <span className="text-blue-300 ml-2">+{formatCurrency(currentMonthData.totalFerie)} i feriepenger (estimat)</span>
        </p>
      </div>

      {/* All Time Highlight */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Estimert lønn totalt</h3>
          <p className="text-2xl font-bold text-white tracking-tight">{formatCurrency(allTimeLonn)}</p>
          <p className="mt-1 text-xs text-gray-500">Basert på registrert timelønn</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feriepenger · estimat</h3>
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
          const hours = calculatePaidHours(nextShift);
          const pay = estimateShiftPay(nextShift, job);
          return (
            <div className="flex justify-between items-center bg-[#2c2c2e] p-4 rounded-2xl">
              <div>
                <h4 className="font-semibold text-blue-300 text-lg">{job?.navn || 'Ukjent jobb'}</h4>
                <p className="text-white font-medium capitalize mt-1">{format(parseISO(nextShift.dato), 'EEEE d. MMM', { locale: nb })}</p>
                <p className="text-sm text-gray-300 mt-1">{nextShift.start} - {nextShift.slutt} · {hours.toFixed(1)} t</p>
                <p className="mt-1 text-xs text-gray-400">Lønnsestimat: {formatCurrency(pay)}</p>
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
          <h2 className="text-lg font-bold text-white mb-5">Månedlig oversikt · estimat</h2>
          <div className="flex flex-col gap-5">
            {monthlyStats.map(stat => (
              <div key={stat.monthDate.toISOString()} className="flex justify-between items-center border-b border-[#2c2c2e] pb-5 last:border-0 last:pb-0">
                <div>
                  <h4 className="font-semibold text-white capitalize text-base tracking-wide">{format(stat.monthDate, 'MMMM yyyy', { locale: nb })}</h4>
                  <p className="text-sm text-gray-400 mt-1 font-medium">{stat.hours.toFixed(1)} timer jobbet</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white text-lg tracking-tight">{formatCurrency(stat.totalLonn)}</p>
                  <p className="text-xs font-semibold text-blue-400 mt-1">+{formatCurrency(stat.totalFerie)} feriepenger</p>
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
function VakterTab({ data, onUpdate, initialDate, onInitialDateApplied }: { data: AppData, onUpdate: (d: AppData) => void, initialDate?: string, onInitialDateApplied: () => void }) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const activeJobs = data.jobs.filter(j => !j.deleted);

  const [filterTerm, setFilterTerm] = useState('');
  const [filterJob, setFilterJob] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterDate, setFilterDate] = useState(initialDate || 'all');

  const [formData, setFormData] = useState(() => {
    let lastUsed: LastShiftDefaults = {};
    try {
      lastUsed = JSON.parse(localStorage.getItem('lastShiftDefaults') || '{}');
    } catch {
      lastUsed = {};
    }
    const rememberedJob = activeJobs.find(job => job.id === lastUsed.jobId);
    return {
      jobId: rememberedJob?.id || activeJobs[0]?.id || '',
      dato: initialDate || today(),
      start: lastUsed.start || '09:00',
      slutt: lastUsed.slutt || '17:00',
      pauseMin: Math.max(0, Number(lastUsed.pauseMin) || 0),
      tilleggNok: Math.max(0, Number(lastUsed.tilleggNok) || 0),
      status: 'Fullfort' as 'Kommende' | 'Fullfort'
    };
  });

  useEffect(() => {
    if (initialDate) onInitialDateApplied();
  }, [initialDate, onInitialDateApplied]);

  const handleEditClick = (shift: Shift) => {
    setIsEditing(shift.id);
    setFormData({
      jobId: shift.jobId,
      dato: shift.dato,
      start: shift.start,
      slutt: shift.slutt,
      pauseMin: Math.max(0, Number(shift.pauseMin) || 0),
      tilleggNok: Math.max(0, Number(shift.tilleggNok) || 0),
      status: shift.status
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!formData.jobId) return setErrorMsg('Velg en jobb først!');

    const iDagStr = today();

    if (Number(formData.pauseMin) < 0 || Number(formData.tilleggNok) < 0) {
      return setErrorMsg('Pause og tillegg kan ikke være negative.');
    }
    if (Number(formData.pauseMin) > calculateHours(formData.start, formData.slutt) * 60) {
      return setErrorMsg('Pausen kan ikke være lengre enn vakten.');
    }

    if (formData.status === 'Fullfort' && formData.dato > iDagStr) {
      return setErrorMsg("Feil: Du kan ikke logge en jobb som 'Fullført' hvis datoen er frem i tid!");
    }
    if (formData.status === 'Kommende' && formData.dato < iDagStr) {
      return setErrorMsg("Feil: Datoen er i fortiden. Sett status til 'Fullført'.");
    }

    try {
      localStorage.setItem('lastShiftDefaults', JSON.stringify({
        jobId: formData.jobId,
        start: formData.start,
        slutt: formData.slutt,
        pauseMin: Number(formData.pauseMin) || 0,
        tilleggNok: Number(formData.tilleggNok) || 0
      }));
    } catch {
      // Keep the shift save usable even if browser storage is unavailable.
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
    
    // Keep daytime defaults for the next entry.
    setFormData(prev => ({ ...prev, dato: today(), status: 'Fullfort' }));
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Vil du slette denne vakten?')) return;
    onUpdate({ ...data, shifts: data.shifts.filter(s => s.id !== id) });
    setErrorMsg(null);
  };

  const handleComplete = (id: string) => {
    const shift = data.shifts.find(s => s.id === id);
    if (!shift) return;
    const iDagStr = today();
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
  const availableMonths = [...new Set(sortedShifts.map(shift => shift.dato.slice(0, 7)))].sort().reverse();
  const visibleShifts = sortedShifts.filter(shift => {
    const jobName = data.jobs.find(job => job.id === shift.jobId)?.navn || '';
    const searchMatches = !filterTerm || jobName.toLowerCase().includes(filterTerm.toLowerCase()) || shift.dato.includes(filterTerm);
    return searchMatches
      && (filterJob === 'all' || shift.jobId === filterJob)
      && (filterStatus === 'all' || shift.status === filterStatus)
      && (filterMonth === 'all' || shift.dato.startsWith(filterMonth))
      && (filterDate === 'all' || shift.dato === filterDate);
  });
  const visibleHours = visibleShifts.reduce((sum, shift) => sum + calculatePaidHours(shift), 0);
  const visiblePay = visibleShifts.reduce((sum, shift) => sum + estimateShiftPay(shift, data.jobs.find(job => job.id === shift.jobId)), 0);
  const hasFilters = Boolean(filterTerm || filterJob !== 'all' || filterStatus !== 'all' || filterMonth !== 'all' || filterDate !== 'all');
  const clearFilters = () => {
    setFilterTerm('');
    setFilterJob('all');
    setFilterStatus('all');
    setFilterMonth('all');
    setFilterDate('all');
  };
  const exportFilteredCsv = () => {
    const rows = [
      ['Dato', 'Jobb', 'Status', 'Start', 'Slutt', 'Ubetalt pause (min)', 'Timer jobbet', 'Lønn (estimat)', 'Feriepenger (estimat)'],
      ...visibleShifts.map(shift => {
        const job = data.jobs.find(item => item.id === shift.jobId);
        const pay = estimateShiftPay(shift, job);
        return [
          shift.dato,
          job?.navn || 'Slettet jobb',
          shift.status === 'Kommende' ? 'Planlagt' : 'Jobbet',
          shift.start,
          shift.slutt,
          String(shift.pauseMin || 0),
          calculatePaidHours(shift).toFixed(2),
          pay.toFixed(2),
          (pay * (job?.feriesats || 0)).toFixed(2)
        ];
      })
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vaktlogg.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ubetalt pause (min)</label>
                <input type="number" min="0" step="5" inputMode="numeric" value={formData.pauseMin} onChange={e => setFormData({...formData, pauseMin: Number(e.target.value)})} className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tillegg denne vakten (kr)</label>
                <input type="number" min="0" step="1" inputMode="decimal" value={formData.tilleggNok} onChange={e => setFormData({...formData, tilleggNok: Number(e.target.value)})} className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="rounded-2xl bg-blue-950/40 border border-blue-900/50 p-4 text-sm">
              <p className="font-semibold text-blue-100">Lønnsestimat: {formatCurrency(Math.max(0, calculateHours(formData.start, formData.slutt) - Math.max(0, Number(formData.pauseMin) || 0) / 60) * (activeJobs.find(job => job.id === formData.jobId)?.lonn || 0) + Math.max(0, Number(formData.tilleggNok) || 0))}</p>
              <p className="mt-1 text-xs leading-relaxed text-blue-200/70">Bruk timelønn, ubetalt pause og tillegg fra arbeidsavtalen din. Appen legger ikke inn tariff- eller helgetillegg automatisk.</p>
            </div>

            <div className="mt-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</label>
              <div className="flex gap-2 bg-[#000000] p-1 rounded-2xl border border-[#2c2c2e]">
                <button type="button" aria-pressed={formData.status === 'Kommende'} onClick={() => setFormData({...formData, status: 'Kommende'})} className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${formData.status === 'Kommende' ? 'bg-[#2c2c2e] shadow-sm text-white' : 'text-gray-500'}`}>Planlagt</button>
                <button type="button" aria-pressed={formData.status === 'Fullfort'} onClick={() => setFormData({...formData, status: 'Fullfort'})} className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${formData.status === 'Fullfort' ? 'bg-[#2c2c2e] shadow-sm text-white' : 'text-gray-500'}`}>Jobbet</button>
              </div>
            </div>

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg py-4 rounded-2xl mt-4 transition-colors active:scale-[0.98]">
              {isEditing ? 'Lagre Endringer' : 'Legg Til Vakt'}
            </button>
          </form>
        )}
      </div>

      {/* VAKT LISTE */}
      <section className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow border border-[#2c2c2e]">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Vaktloggen</h3>
            <p className="mt-1 text-sm text-gray-400">
              {visibleShifts.length} vakter · {visibleHours.toFixed(1)} timer · {formatCurrency(visiblePay)} estimert lønn
            </p>
          </div>
          <button type="button" onClick={exportFilteredCsv} disabled={visibleShifts.length === 0} className="min-h-11 w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm font-bold text-blue-300 disabled:opacity-40">
            Last ned CSV-rapport
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="search"
            value={filterTerm}
            onChange={e => setFilterTerm(e.target.value)}
            placeholder="Søk på jobb eller dato"
            aria-label="Søk i vaktloggen"
            className="w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} aria-label="Filtrer på måned" className="w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Alle måneder</option>
            {availableMonths.map(month => <option key={month} value={month}>{format(parseISO(month + '-01'), 'MMMM yyyy', { locale: nb })}</option>)}
          </select>
          <select value={filterJob} onChange={e => setFilterJob(e.target.value)} aria-label="Filtrer på jobb" className="w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Alle jobber</option>
            {data.jobs.map(job => <option key={job.id} value={job.id}>{job.navn}{job.deleted ? ' (arkivert)' : ''}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filtrer på status" className="w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Alle statuser</option>
            <option value="Kommende">Planlagt</option>
            <option value="Fullfort">Jobbet</option>
          </select>
          <input
            type="date"
            value={filterDate === 'all' ? '' : filterDate}
            onChange={e => setFilterDate(e.target.value || 'all')}
            aria-label="Filtrer på dato"
            className="w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {hasFilters && <button type="button" onClick={clearFilters} className="mt-3 min-h-11 px-3 text-sm font-semibold text-blue-300">Nullstill filtre</button>}
      </section>

      <div className="flex flex-col gap-3">
        {sortedShifts.length === 0 ? (
          <div className="bg-[#1c1c1e] rounded-3xl p-8 text-center text-gray-400">
            <p className="font-semibold text-white">Ingen vakter registrert ennå</p>
            <p className="mt-2 text-sm">Legg inn en vakt, så får du oversikt over timer og lønnsestimat her.</p>
          </div>
        ) : visibleShifts.length === 0 ? (
          <div className="bg-[#1c1c1e] rounded-3xl p-8 text-center text-gray-400">
            <p className="font-semibold text-white">Ingen vakter passer til filtrene</p>
            <button type="button" onClick={clearFilters} className="mt-3 min-h-11 px-3 text-sm font-bold text-blue-300">Vis alle vakter</button>
          </div>
        ) : (
          visibleShifts.map(s => {
            const job = data.jobs.find(j => j.id === s.jobId);
            const hours = calculatePaidHours(s);
            const pay = estimateShiftPay(s, job);
            return (
              <article key={s.id} className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow flex flex-col gap-4 border border-[#2c2c2e]">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <h4 className="font-bold text-white text-lg">{job?.navn || 'Slettet jobb'}</h4>
                    <p className="text-sm text-gray-400 capitalize mt-1 font-medium">{format(parseISO(s.dato), 'EEEE d. MMM yyyy', { locale: nb })}</p>
                  </div>
                  <div className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-widest ${s.status === 'Kommende' ? 'bg-orange-900/40 text-orange-300' : 'bg-green-900/40 text-green-300'}`}>
                    {s.status === 'Kommende' ? 'Planlagt' : 'Jobbet'}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#2c2c2e] px-4 py-3 text-sm">
                  <div className="flex justify-between text-white font-medium">
                    <span>{s.start}–{s.slutt}</span>
                    <span>{hours.toFixed(1)} t jobbet</span>
                  </div>
                  {Number(s.pauseMin) > 0 && <p className="mt-1 text-xs text-gray-400">Ubetalt pause: {s.pauseMin} min</p>}
                  <div className="mt-3 flex justify-between border-t border-white/10 pt-3">
                    <span className="text-gray-300">Lønn, estimat</span>
                    <span className="font-bold text-white">{formatCurrency(pay)}</span>
                  </div>
                  {Number(s.tilleggNok) > 0 && <p className="mt-1 text-right text-xs text-gray-400">Inkl. {formatCurrency(Number(s.tilleggNok))} tillegg</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {s.status === 'Kommende' && (
                    <button onClick={() => handleComplete(s.id)} className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-green-900/30 text-green-300 hover:bg-green-900/50 rounded-xl text-sm font-bold transition-colors">
                      <CheckCircle2 size={16} strokeWidth={2.5} /> Ferdig
                    </button>
                  )}
                  <button onClick={() => handleEditClick(s)} className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-[#2c2c2e] text-blue-300 hover:bg-[#38383a] rounded-xl text-sm font-bold transition-colors">
                    <Edit2 size={16} strokeWidth={2.5} /> Endre
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-[#2c2c2e] text-red-300 hover:bg-[#38383a] rounded-xl text-sm font-bold transition-colors">
                    <Trash2 size={16} strokeWidth={2.5} /> Slett
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- KALENDER TAB ---
function KalenderTab({ data, onOpenDate }: { data: AppData, onOpenDate: (date: string) => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(today());

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });
  const firstDayOfWeek = getDay(startOfMonth(currentMonth)) || 7;
  const prefixDays = Array.from({ length: firstDayOfWeek - 1 });
  const selectedShifts = selectedDate ? data.shifts.filter(shift => shift.dato === selectedDate) : [];

  return (
    <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
        <div className="flex justify-between items-center mb-6 px-1">
          <button type="button" aria-label="Forrige måned" onClick={() => { setCurrentMonth(subMonths(currentMonth, 1)); setSelectedDate(null); }} className="min-h-11 min-w-11 flex items-center justify-center text-blue-300 hover:bg-[#2c2c2e] rounded-full transition-colors">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-xl font-bold text-white capitalize tracking-tight">
            {format(currentMonth, 'MMMM yyyy', { locale: nb })}
          </h2>
          <button type="button" aria-label="Neste måned" onClick={() => { setCurrentMonth(addMonths(currentMonth, 1)); setSelectedDate(null); }} className="min-h-11 min-w-11 flex items-center justify-center text-blue-300 hover:bg-[#2c2c2e] rounded-full transition-colors">
            <ChevronRight size={24} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">
          <div>Ma</div><div>Ti</div><div>On</div><div>To</div><div>Fr</div><div>Lø</div><div>Sø</div>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {prefixDays.map((_, i) => <div key={`empty-${i}`} className="h-14" />)}
          {daysInMonth.map(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const dayShifts = data.shifts.filter(shift => shift.dato === dateStr);
            const isCurrentDay = isToday(date);
            const isSelected = selectedDate === dateStr;
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                aria-label={`${format(date, 'EEEE d. MMMM', { locale: nb })}, ${dayShifts.length} vakter`}
                aria-pressed={isSelected}
                className={`relative h-14 rounded-xl flex flex-col items-center justify-start pt-1.5 border-2 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${isSelected ? 'border-blue-400 bg-blue-900/30' : isCurrentDay ? 'border-blue-500/50 bg-blue-900/20' : 'border-transparent bg-[#2c2c2e]'}`}
              >
                <span className={`text-sm font-bold ${isSelected || isCurrentDay ? 'text-blue-300' : 'text-gray-200'}`}>{format(date, 'd')}</span>
                <div className="w-full px-1.5 flex flex-col gap-1 mt-1">
                  {dayShifts.slice(0, 3).map(shift => (
                    <span key={shift.id} className={`h-1.5 w-full rounded-full ${shift.status === 'Fullfort' ? 'bg-green-400' : 'bg-orange-400'}`} />
                  ))}
                  {dayShifts.length > 3 && <span className="text-[9px] leading-none text-gray-300">+{dayShifts.length - 3}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-6 mt-5 pt-4 border-t border-[#2c2c2e] justify-center text-xs text-gray-300 font-semibold">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-400" />Planlagt</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-400" />Jobbet</div>
        </div>
      </div>

      {selectedDate && (
        <section className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow border border-[#2c2c2e]">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Valgt dag</p>
              <h3 className="mt-1 text-lg font-bold text-white capitalize">
                {format(parseISO(selectedDate), 'EEEE d. MMMM yyyy', { locale: nb })}
              </h3>
            </div>
            <button type="button" onClick={() => onOpenDate(selectedDate)} className="min-h-11 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-500">
              Åpne vakter denne dagen
            </button>
          </div>
          {selectedShifts.length === 0 ? (
            <p className="mt-4 rounded-xl bg-[#2c2c2e] p-4 text-sm text-gray-300">Ingen vakter denne dagen.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {selectedShifts.map(shift => {
                const job = data.jobs.find(item => item.id === shift.jobId);
                return (
                  <article key={shift.id} className="rounded-2xl bg-[#2c2c2e] p-4">
                    <div className="flex justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-white">{job?.navn || 'Slettet jobb'}</h4>
                        <p className="mt-1 text-sm text-gray-300">{shift.start}–{shift.slutt} · {calculatePaidHours(shift).toFixed(1)} t</p>
                      </div>
                      <span className="text-xs font-bold text-blue-200">{formatCurrency(estimateShiftPay(shift, job))}</span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">{shift.status === 'Kommende' ? 'Planlagt' : 'Jobbet'} · lønnsestimat</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// --- INNSTILLINGER TAB ---
function InnstillingerTab({
  data,
  onUpdate,
  installPromptAvailable,
  isInstalled,
  onInstall
}: {
  data: AppData;
  onUpdate: (d: AppData) => void;
  installPromptAvailable: boolean;
  isInstalled: boolean;
  onInstall: () => void;
}) {
  const [newJob, setNewJob] = useState({ navn: '', lonn: '', ferie: '10' });
  const [jobError, setJobError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{ type: 'success'|'error', msg: string } | null>(null);
  const [autoBackup, setAutoBackup] = useState(loadRecoveryBackup);

  const activeJobs = data.jobs.filter(j => !j.deleted);

  useEffect(() => {
    setAutoBackup(loadRecoveryBackup());
  }, [data]);

  const handleExport = () => {
    const backupData = {
      format: 'min-vaktbok-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      jobs: data.jobs,
      shifts: data.shifts
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
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
        const importedData = JSON.parse(event.target?.result as string) as Partial<BackupFile> & { myJobs?: string | Job[]; myShifts?: string | Shift[] };
        const decode = (value: string | Job[] | Shift[] | undefined) =>
          typeof value === 'string' ? JSON.parse(value) : value;
        const jobs = (importedData.jobs || decode(importedData.myJobs) || []) as Job[];
        const shifts = (importedData.shifts || decode(importedData.myShifts) || []) as Shift[];
        const validJobs = Array.isArray(jobs) && jobs.every(job =>
          job && job.id !== undefined && typeof job.navn === 'string' && Number.isFinite(Number(job.lonn)) && Number.isFinite(Number(job.feriesats))
        );
        const validShifts = Array.isArray(shifts) && shifts.every(shift =>
          shift && shift.id !== undefined && shift.jobId !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(shift.dato)
          && /^\d{2}:\d{2}$/.test(shift.start) && /^\d{2}:\d{2}$/.test(shift.slutt)
          && (shift.status === 'Kommende' || shift.status === 'Fullfort')
        );
        if (!validJobs || !validShifts) throw new Error('Backupfilen inneholder data i et ukjent format.');
        if (!window.confirm('Importen erstatter vaktlisten og jobbene på denne enheten. Fortsette?')) return;

        const normalizedJobs: Job[] = jobs.map(job => ({
          ...job,
          id: String(job.id),
          lonn: Number(job.lonn),
          feriesats: Number(job.feriesats)
        }));
        const normalizedShifts: Shift[] = shifts.map(shift => ({
          ...shift,
          id: String(shift.id),
          jobId: String(shift.jobId),
          pauseMin: Math.max(0, Number(shift.pauseMin) || 0),
          tilleggNok: Math.max(0, Number(shift.tilleggNok) || 0)
        }));
        onUpdate({ jobs: normalizedJobs, shifts: normalizedShifts });
        setAutoBackup({
          savedAt: new Date().toISOString(),
          jobs: data.jobs,
          shifts: data.shifts
        });
        setImportStatus({ type: 'success', msg: 'Sikkerhetskopien er importert.' });
      } catch {
        setImportStatus({ type: 'error', msg: 'Filen kunne ikke leses. Velg en Vakter-sikkerhetskopi i JSON-format.' });
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleRestoreAutoBackup = () => {
    if (!autoBackup) return;
    if (!window.confirm('Gjenopprette forrige automatiske sikkerhetskopi? Dette bytter ut den nåværende vaktlisten.')) return;
    onUpdate({ jobs: autoBackup.jobs, shifts: autoBackup.shifts });
    setImportStatus({ type: 'success', msg: 'Forrige sikkerhetskopi er gjenopprettet.' });
  };

  const handleAddJob = (e: React.FormEvent) => {
    e.preventDefault();
    const hourlyRate = Number(newJob.lonn);
    const holidayRate = Number(newJob.ferie);
    if (!newJob.navn.trim() || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      setJobError('Skriv inn jobbnavn og en timelønn større enn null.');
      return;
    }
    if (!Number.isFinite(holidayRate) || holidayRate < 0 || holidayRate > 100) {
      setJobError('Feriesatsen må være mellom 0 og 100 prosent.');
      return;
    }
    setJobError(null);
    const job: Job = {
      id: Date.now().toString(),
      navn: newJob.navn.trim(),
      lonn: hourlyRate,
      feriesats: holidayRate / 100
    };
    onUpdate({ ...data, jobs: [...data.jobs, job] });
    setNewJob({ navn: '', lonn: '', ferie: '10' });
  };

  const handleDeleteJob = (id: string) => {
    if (!window.confirm('Arkivere denne jobben? Tidligere vakter blir bevart.')) return;
    onUpdate({
      ...data,
      jobs: data.jobs.map(j => j.id === id ? { ...j, deleted: true } : j)
    });
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

      <section className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow border border-[#2c2c2e]" aria-labelledby="install-app-heading">
        <h2 id="install-app-heading" className="text-xl font-bold text-white mb-2">Bruk Vakter som app</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          Legg Vakter på hjemskjermen for rask tilgang. Vaktene lagres på denne enheten og blir tilgjengelige uten nett etter første åpning mens du er på nett. Registreringene synkroniseres ikke automatisk mellom enheter.
        </p>
        {isInstalled ? (
          <p className="mt-4 rounded-xl bg-green-900/30 px-4 py-3 text-sm font-semibold text-green-300">Vakter er installert på denne enheten.</p>
        ) : (
          <>
            {installPromptAvailable && (
              <button onClick={onInstall} className="mt-4 w-full min-h-12 rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-500">
                Installer Vakter
              </button>
            )}
            <details className="mt-4 rounded-xl bg-[#2c2c2e] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">Slik legger du appen på hjemskjermen</summary>
              <div className="mt-3 space-y-2 text-sm text-gray-300">
                <p><strong>iPhone:</strong> Åpne siden i Safari, trykk Del og velg «Legg til på Hjem-skjerm».</p>
                <p><strong>Android:</strong> Åpne nettlesermenyen og velg «Installer app» eller «Legg til på startskjermen».</p>
              </div>
            </details>
          </>
        )}
      </section>

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
                <button onClick={() => handleDeleteJob(j.id)} aria-label={`Arkiver ${j.navn}`} className="min-h-11 min-w-11 p-3 text-red-300 hover:bg-[#38383a] rounded-xl transition-colors">
                  <Trash2 size={20} />
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="text-base font-bold text-white mb-4 border-t border-[#2c2c2e] pt-5">Legg til ny jobb</h3>
        <form onSubmit={handleAddJob} className="flex flex-col gap-4">
          {jobError && <p role="alert" className="rounded-xl bg-red-900/30 p-3 text-sm text-red-300">{jobError}</p>}
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
        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Sikkerhetskopi</h2>
        <p className="mb-5 text-sm leading-relaxed text-gray-400">Vaktdata lagres på denne enheten og synkroniseres ikke automatisk. Eksporter en kopi før du bytter telefon eller nettleser.</p>
        
        {importStatus && (
          <div className={`p-4 rounded-xl text-sm font-medium mb-4 flex gap-2 items-center ${importStatus.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-500/20' : 'bg-red-900/30 text-red-400 border border-red-500/20'}`}>
            <AlertCircle size={18} className="shrink-0" />
            {importStatus.msg}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button onClick={handleExport} className="w-full min-h-12 bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] active:scale-[0.98]">
            💾 Last ned sikkerhetskopi
          </button>
          <label className="w-full min-h-12 bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] active:scale-[0.98] text-center cursor-pointer block">
            📂 Gjenopprett fra fil
            <input type="file" accept=".json,application/json" onChange={handleImport} className="hidden" />
          </label>
          {autoBackup && (
            <div className="rounded-2xl border border-[#2c2c2e] p-4">
              <p className="text-sm text-gray-300">En tidligere versjon lagres automatisk før du endrer vakter eller jobber.</p>
              <p className="mt-1 text-xs text-gray-500">Sist lagret: {format(parseISO(autoBackup.savedAt), 'd. MMM yyyy HH:mm', { locale: nb })}</p>
              <button type="button" onClick={handleRestoreAutoBackup} className="mt-3 min-h-11 w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm font-bold text-blue-300">Gjenopprett forrige versjon</button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
