import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Home, Calendar, Clock, Settings, Plus, Edit2, Trash2, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, RotateCw, AlertCircle, Copy } from 'lucide-react';
import { format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isValid } from 'date-fns';
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
  timelonn?: number;
  pauseMin?: number;
  tilleggNok?: number;
}

interface AppData {
  jobs: Job[];
  shifts: Shift[];
  monthReviews?: Record<string, string>;
}

interface BackupPreview {
  data: AppData;
  name: string;
  savedAt?: string;
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
const MONTH_REVIEWS_KEY = 'myVaktbokMonthReviews';
const APP_DATA_KEY = 'myVaktbokData';
const LAST_EXPORT_KEY = 'myVaktbokLastExport';
const BACKUP_FORMAT = 'min-vaktbok-backup';

// --- UTILS ---
const clockMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

type ShiftTimes = Pick<Shift, 'dato' | 'start' | 'slutt'>;
const minutesPerDay = 24 * 60;
const crossesMidnight = ({ start, slutt }: Pick<ShiftTimes, 'start' | 'slutt'>) =>
  clockMinutes(slutt) < clockMinutes(start);

const shiftDurationMinutes = (start: string, slutt: string) =>
  clockMinutes(slutt) - clockMinutes(start) + (crossesMidnight({ start, slutt }) ? minutesPerDay : 0);

const shiftInterval = ({ dato, start, slutt }: ShiftTimes) => {
  // Use calendar days and wall clock times, as in the shift form.
  const begins = Date.parse(dato + 'T00:00:00Z') / 60_000 + clockMinutes(start);
  return { begins, ends: begins + shiftDurationMinutes(start, slutt) };
};

const findOverlappingShifts = (draft: ShiftTimes, shifts: Shift[], editedId?: string) => {
  const { begins, ends } = shiftInterval(draft);
  if (!(begins < ends)) return [];

  return shifts.filter(shift => {
    if (shift.id === editedId) return false;
    const other = shiftInterval(shift);
    return other.begins < other.ends && begins < other.ends && other.begins < ends;
  });
};

const today = () => format(new Date(), 'yyyy-MM-dd');

const unpaidPauseMinutes = (shift: Pick<Shift, 'pauseMin'>) => Math.max(0, Number(shift.pauseMin) || 0);
const shiftSupplement = (shift: Pick<Shift, 'tilleggNok'>) => Math.max(0, Number(shift.tilleggNok) || 0);

const paidMinutes = (shift: Pick<Shift, 'start' | 'slutt' | 'pauseMin'>) =>
  Math.max(0, shiftDurationMinutes(shift.start, shift.slutt) - unpaidPauseMinutes(shift));

const calculatePaidHours = (shift: Pick<Shift, 'start' | 'slutt' | 'pauseMin'>) => paidMinutes(shift) / 60;

const isHourlyRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const hourlyRateForShift = (shift: Pick<Shift, 'timelonn'>, job?: Job) =>
  isHourlyRate(shift.timelonn) ? shift.timelonn : isHourlyRate(job?.lonn) ? job.lonn : undefined;

const estimateShiftPay = (shift: Omit<Shift, 'id'>, job?: Job) => {
  const rate = hourlyRateForShift(shift, job);
  return rate === undefined ? 0 : calculatePaidHours(shift) * rate + shiftSupplement(shift);
};

const withShiftRates = (data: AppData): AppData => ({
  ...data,
  shifts: data.shifts.map(shift => isHourlyRate(shift.timelonn) ? shift : {
    ...shift,
    timelonn: hourlyRateForShift(shift, data.jobs.find(job => job.id === shift.jobId))
  })
});

const formatCurrency = (val: number, maximumFractionDigits = 0) => {
  return new Intl.NumberFormat('no-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits }).format(val);
};

const normalizeMonthReviews = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, string] => /^\d{4}-(0[1-9]|1[0-2])$/.test(entry[0]) && typeof entry[1] === 'string'
  ));
};

const loadMonthReviews = () => {
  try {
    return normalizeMonthReviews(JSON.parse(localStorage.getItem(MONTH_REVIEWS_KEY) ?? '{}'));
  } catch {
    return {};
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validId = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value));

const backupNumber = (value: unknown) =>
  typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;

const validBackupDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));

const validBackupTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const backupTimestamp = (value: unknown) =>
  typeof value === 'string' && isValid(parseISO(value)) ? value : undefined;

const decodeLegacyBackupList = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value ?? [];

const parseBackup = (value: unknown): AppData => {
  if (!isRecord(value) || (value.format !== undefined && value.format !== BACKUP_FORMAT)) {
    throw new Error('Velg en sikkerhetskopi fra Vakter.');
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error('Denne sikkerhetskopien er laget med en annen versjon av Vakter.');
  }
  const legacy = !('jobs' in value || 'shifts' in value) && 'myJobs' in value && 'myShifts' in value;
  const rawJobs = legacy ? decodeLegacyBackupList(value.myJobs) : value.jobs;
  const rawShifts = legacy ? decodeLegacyBackupList(value.myShifts) : value.shifts;
  if (!Array.isArray(rawJobs) || !Array.isArray(rawShifts)) {
    throw new Error('Sikkerhetskopien må inneholde både jobber og vakter.');
  }

  const jobs: Job[] = rawJobs.map(job => {
    if (!isRecord(job) || !validId(job.id) || typeof job.navn !== 'string') {
      throw new Error('Sikkerhetskopien inneholder en ugyldig jobb.');
    }
    const lonn = backupNumber(job.lonn);
    const feriesats = backupNumber(job.feriesats);
    if (!isHourlyRate(lonn) || !isHourlyRate(feriesats)) {
      throw new Error('En jobb i sikkerhetskopien har ugyldige lønnssatser.');
    }
    return { id: String(job.id), navn: job.navn, lonn, feriesats, deleted: job.deleted === true };
  });

  const shifts: Shift[] = rawShifts.map(shift => {
    if (!isRecord(shift) || !validId(shift.id) || !validId(shift.jobId)
      || !validBackupDate(shift.dato) || !validBackupTime(shift.start) || !validBackupTime(shift.slutt)
      || (shift.status !== 'Kommende' && shift.status !== 'Fullfort')) {
      throw new Error('En vakt i sikkerhetskopien har ugyldig dato, tid eller status.');
    }
    const pauseMin = backupNumber(shift.pauseMin ?? 0);
    const tilleggNok = backupNumber(shift.tilleggNok ?? 0);
    const timelonn = shift.timelonn == null ? undefined : backupNumber(shift.timelonn);
    if (!isHourlyRate(pauseMin) || !isHourlyRate(tilleggNok) || (timelonn !== undefined && !isHourlyRate(timelonn))) {
      throw new Error('En vakt i sikkerhetskopien har ugyldig pause, tillegg eller timelønn.');
    }
    return {
      id: String(shift.id), jobId: String(shift.jobId), dato: shift.dato, start: shift.start,
      slutt: shift.slutt, status: shift.status, pauseMin, tilleggNok, timelonn
    };
  });

  if (new Set(jobs.map(job => job.id)).size !== jobs.length || new Set(shifts.map(shift => shift.id)).size !== shifts.length) {
    throw new Error('Sikkerhetskopien inneholder doble registreringer.');
  }
  return withShiftRates({ jobs, shifts, monthReviews: normalizeMonthReviews(value.monthReviews) });
};

const storeData = (data: AppData, previous: AppData) => {
  const recovery = { savedAt: new Date().toISOString(), ...previous };
  // Save the active data and recovery copy together so a failed write changes neither.
  localStorage.setItem(APP_DATA_KEY, JSON.stringify({ data, recovery }));
};

// --- INITIAL DATA LOAD ---
const loadData = (): AppData => {
  try {
    const stored = localStorage.getItem(APP_DATA_KEY);
    if (stored) {
      const { data } = JSON.parse(stored) as { data: AppData };
      return withShiftRates({ ...data, monthReviews: normalizeMonthReviews(data.monthReviews) });
    }
    const savedJobs = localStorage.getItem('myJobs');
    const savedShifts = localStorage.getItem('myShifts');
    
    let jobs: Job[] = savedJobs ? JSON.parse(savedJobs) : [
      { id: "1", navn: "Hovedjobb", lonn: 190.00, feriesats: 0.10 }
    ];
    let shifts: Shift[] = savedShifts ? JSON.parse(savedShifts) : [];

    jobs = jobs.map(j => ({ ...j, id: String(j.id) }));
    shifts = shifts.map(s => ({ ...s, id: String(s.id), jobId: String(s.jobId) }));

    return withShiftRates({ jobs, shifts, monthReviews: loadMonthReviews() });
  } catch (e) {
    return { jobs: [], shifts: [] };
  }
};

const loadRecoveryBackup = (): BackupPreview | null => {
  try {
    const stored = localStorage.getItem(APP_DATA_KEY);
    const backup: unknown = stored
      ? JSON.parse(stored).recovery
      : JSON.parse(localStorage.getItem(AUTO_BACKUP_KEY) ?? 'null');
    if (!isRecord(backup)) return null;
    return { data: parseBackup(backup), name: 'Forrige automatiske kopi', savedAt: backupTimestamp(backup.savedAt) };
  } catch {
    return null;
  }
};

const loadLastExport = () => {
  try {
    return backupTimestamp(localStorage.getItem(LAST_EXPORT_KEY));
  } catch {
    return undefined;
  }
};

export default function App() {
  // --- STATE: HISTORY & DATA ---
  const [history, setHistory] = useState<AppData[]>(() => [loadData()]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [storageError, setStorageError] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vakter' | 'kalender' | 'innstillinger'>('dashboard');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dateForShiftLog, setDateForShiftLog] = useState<string | undefined>();
  const [shiftEditor, setShiftEditor] = useState<{ shift?: Shift; date?: string } | null>(null);
  const shiftEditorTrigger = useRef<HTMLElement | null>(null);

  const openShiftEditor = (shift?: Shift, date?: string) => {
    shiftEditorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShiftEditor({ shift, date });
  };

  useEffect(() => {
    if (shiftEditor || !shiftEditorTrigger.current) return;
    shiftEditorTrigger.current.focus();
    shiftEditorTrigger.current = null;
  }, [shiftEditor]);

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

  const persistData = (newData: AppData) => {
    try {
      storeData(newData, currentData);
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  };

  const updateData = (newData: AppData) => {
    if (!persistData(newData)) return false;
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(newData);
    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
    return true;
  };

  const saveShift = (shift: Omit<Shift, 'id'>, id?: string) => {
    const saved = updateData({
      ...currentData,
      shifts: id
        ? currentData.shifts.map(saved => saved.id === id ? { ...saved, ...shift } : saved)
        : [{ ...shift, id: crypto.randomUUID() }, ...currentData.shifts]
    });
    if (saved) setShiftEditor(null);
    return saved;
  };

  const undo = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      if (persistData(history[newIndex])) setCurrentIndex(newIndex);
    }
  };

  const redo = () => {
    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      if (persistData(history[newIndex])) setCurrentIndex(newIndex);
    }
  };

  return (
    <div className="min-h-screen bg-black pb-24 font-sans flex flex-col items-center text-white">
      
      {/* HEADER (iOS Style) */}
      <div className={shiftEditor ? 'hidden' : "sticky top-0 z-50 w-full max-w-md ios-blur border-b border-[#2c2c2e] px-4 py-3 flex justify-between items-center"}>
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
      <main className={shiftEditor ? 'hidden' : "w-full max-w-md px-4 py-6 pb-32 flex-1 flex flex-col gap-6"}>
        {storageError && !shiftEditor && <p role="alert" className="rounded-xl bg-red-900/30 p-3 text-sm text-red-300">Endringen kunne ikke lagres på denne enheten.</p>}
        {activeTab === 'dashboard' && <Dashboard data={currentData} onLogShift={() => openShiftEditor()} onUpdate={updateData} />}
        {activeTab === 'vakter' && <VakterTab data={currentData} onUpdate={updateData} onOpenEditor={openShiftEditor} initialDate={dateForShiftLog} onInitialDateApplied={() => setDateForShiftLog(undefined)} />}
        {activeTab === 'kalender' && <KalenderTab data={currentData} onOpenDate={(date) => { setDateForShiftLog(date); setActiveTab('vakter'); }} />}
        {activeTab === 'innstillinger' && <InnstillingerTab data={currentData} onUpdate={updateData} installPromptAvailable={Boolean(installPrompt)} isInstalled={isInstalled} onInstall={installApp} />}
      </main>

      {shiftEditor && (
        <main className="w-full max-w-md px-4 pt-4 pb-8">
          <ShiftForm
            data={currentData}
            shift={shiftEditor.shift}
            date={shiftEditor.date}
            onSave={saveShift}
            onCancel={() => setShiftEditor(null)}
            onOpenJobs={() => {
              shiftEditorTrigger.current = null;
              setShiftEditor(null);
              setActiveTab('innstillinger');
            }}
          />
        </main>
      )}

      {/* BOTTOM TAB BAR */}
      <div className={shiftEditor ? 'hidden' : "fixed bottom-0 left-0 right-0 z-50 bg-[#111318]/95 backdrop-blur-xl border-t border-[#2c2c2e] flex justify-center pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 px-2"}>
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

interface WorkTotals {
  count: number;
  paid: number;
  pause: number;
  supplements: number;
  gross: number;
  holidayPay: number;
}

const emptyWorkTotals = (): WorkTotals => ({ count: 0, paid: 0, pause: 0, supplements: 0, gross: 0, holidayPay: 0 });

const addWorkTotals = (total: WorkTotals, entry: WorkTotals) => {
  total.count += entry.count;
  total.paid += entry.paid;
  total.pause += entry.pause;
  total.supplements += entry.supplements;
  total.gross += entry.gross;
  total.holidayPay += entry.holidayPay;
};

const buildMonthlyReports = (shifts: Shift[], jobs: Map<string, Job>) => {
  const months = new Map<string, { total: WorkTotals; byJob: Map<string, WorkTotals> }>();

  for (const shift of shifts) {
    if (shift.status !== 'Fullfort') continue;
    const monthKey = shift.dato.slice(0, 7);
    const month = months.get(monthKey) ?? { total: emptyWorkTotals(), byJob: new Map<string, WorkTotals>() };
    const job = jobs.get(shift.jobId);
    const gross = estimateShiftPay(shift, job);
    const entry = {
      count: 1,
      paid: paidMinutes(shift),
      pause: unpaidPauseMinutes(shift),
      supplements: shiftSupplement(shift),
      gross,
      holidayPay: gross * (job?.feriesats ?? 0)
    };
    const jobTotal = month.byJob.get(shift.jobId) ?? emptyWorkTotals();

    addWorkTotals(jobTotal, entry);
    addWorkTotals(month.total, entry);
    month.byJob.set(shift.jobId, jobTotal);
    months.set(monthKey, month);
  }

  return months;
};

// --- DASHBOARD COMPONENT ---
function Dashboard({ data, onLogShift, onUpdate }: {
  data: AppData;
  onLogShift: () => void;
  onUpdate: (data: AppData) => void;
}) {
  const iDagStr = today();
  const currentMonthKey = iDagStr.slice(0, 7);
  const jobs = useMemo(() => new Map(data.jobs.map(job => [job.id, job])), [data.jobs]);
  const months = useMemo(() => buildMonthlyReports(data.shifts, jobs), [data.shifts, jobs]);
  const currentMonthData = months.get(currentMonthKey)?.total ?? emptyWorkTotals();
  const allTime = emptyWorkTotals();
  months.forEach(month => addWorkTotals(allTime, month.total));

  const nextShift = data.shifts
    .filter(shift => shift.status === 'Kommende' && shift.dato >= iDagStr)
    .sort((a, b) => a.dato.localeCompare(b.dato) || a.start.localeCompare(b.start))[0];

  return (
    <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <button
        onClick={onLogShift}
        className="w-full min-h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] px-5 py-4 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-950/30 transition"
      >
        <Plus size={20} strokeWidth={2.5} /> Logg vakt
      </button>

      {/* Current Month Highlight */}
      <div className="bg-[#1c1c1e] rounded-3xl p-6 ios-shadow">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Lønn denne måneden · estimat</h2>
        <div className="text-5xl font-bold text-white mb-2 tracking-tight">{formatCurrency(currentMonthData.gross)}</div>
        <p className="text-sm text-gray-500 font-medium">
          Registrert arbeid på {(currentMonthData.paid / 60).toFixed(1)} timer
          <span className="text-blue-300 ml-2">+{formatCurrency(currentMonthData.holidayPay)} i feriepenger (estimat)</span>
        </p>
        <a href="#maanedsrapport" className="mt-2 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-blue-300 underline underline-offset-4">
          Se månedsrapport
        </a>
      </div>

      {/* All Time Highlight */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Estimert lønn totalt</h3>
          <p className="text-2xl font-bold text-white tracking-tight">{formatCurrency(allTime.gross)}</p>
          <p className="mt-1 text-xs text-gray-500">Basert på registrert timelønn</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feriepenger · estimat</h3>
          <p className="text-2xl font-bold text-blue-500 tracking-tight">{formatCurrency(allTime.holidayPay)}</p>
        </div>
      </div>

      {/* Next Shift */}
      <div className="bg-[#1c1c1e] rounded-3xl p-5 ios-shadow mt-2">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Calendar size={20} className="text-blue-500" /> Neste vakt
        </h2>
        {nextShift ? (() => {
          const job = jobs.get(nextShift.jobId);
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

      <MonthlyReport
        currentMonth={currentMonthKey}
        months={months}
        jobs={jobs}
        reviews={data.monthReviews}
        onReviewChange={monthReviews => onUpdate({ ...data, monthReviews })}
      />
    </div>
  );
}

const monthLabel = (key: string) => format(parseISO(key + '-01'), 'LLLL yyyy', { locale: nb });

const formatWorkDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts = [];
  if (hours > 0) parts.push(hours + ' t');
  if (remainder > 0 || hours === 0) parts.push(remainder.toLocaleString('nb-NO', { maximumFractionDigits: 2 }) + ' min');
  return parts.join(' ');
};

function MonthlyReport({ currentMonth, months, jobs, reviews, onReviewChange }: {
  currentMonth: string;
  months: ReturnType<typeof buildMonthlyReports>;
  jobs: Map<string, Job>;
  reviews?: AppData['monthReviews'];
  onReviewChange: (reviews: NonNullable<AppData['monthReviews']>) => void;
}) {
  const [selection, setSelection] = useState(currentMonth);
  const monthKeys = [...new Set([currentMonth, ...months.keys()])].sort().reverse();
  const monthKey = monthKeys.includes(selection) ? selection : currentMonth;
  const month = months.get(monthKey);
  const rows = month ? [...month.byJob.entries()].sort(([a], [b]) => a.localeCompare(b)) : [];
  const numbersForReview = (totals: WorkTotals) => [
    totals.count, totals.paid, totals.pause,
    totals.supplements.toFixed(2), totals.gross.toFixed(2), totals.holidayPay.toFixed(2)
  ];
  const signature = month ? JSON.stringify([
    numbersForReview(month.total),
    rows.map(([id, totals]) => [id, numbersForReview(totals)])
  ]) : '';
  const previousReview = reviews?.[monthKey];
  const checked = Boolean(month && previousReview === signature);

  const setChecked = (value: boolean) => {
    if (!month) return;
    const next = { ...reviews };
    if (value) next[monthKey] = signature;
    else delete next[monthKey];
    onReviewChange(next);
  };

  return (
    <section id="maanedsrapport" className="scroll-mt-20 rounded-3xl bg-[#1c1c1e] p-5 ios-shadow" aria-labelledby="month-report-heading">
      <h2 id="month-report-heading" className="text-lg font-bold">Månedsrapport</h2>
      <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-gray-300">
        Måned
        <select value={monthKey} onChange={event => setSelection(event.target.value)} className="min-h-11 w-full rounded-xl bg-[#2c2c2e] px-3 text-base capitalize text-white [color-scheme:dark]">
          {monthKeys.map(key => <option key={key} value={key}>{monthLabel(key)}</option>)}
        </select>
      </label>
      <p className="mt-3 text-sm text-gray-400">Vakter med status «Jobbet» vises etter startdato. Lønn og feriepenger er estimater.</p>

      {month ? (
        <div className="mt-4 space-y-3">
          <MonthlyWorkCard title="Totalt for måneden" totals={month.total} />
          {rows.map(([id, totals]) => (
            <MonthlyWorkCard key={id} title={jobs.get(id)?.navn ?? 'Ukjent jobb'} totals={totals} />
          ))}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold">
            <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} className="h-5 w-5 shrink-0 accent-blue-500" />
            Sjekket mot lønnsslipp
          </label>
          {previousReview && !checked && <p className="text-sm text-orange-300">Tallene har endret seg siden du sjekket rapporten.</p>}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-[#2c2c2e] p-4 text-sm text-gray-300">Ingen vakter med status «Jobbet» denne måneden.</p>
      )}
    </section>
  );
}

function MonthlyWorkCard({ title, totals }: { title: string; totals: WorkTotals }) {
  const rows = [
    ['Betalt tid', formatWorkDuration(totals.paid)],
    ['Ubetalt pause', formatWorkDuration(totals.pause)],
    ['Registrerte tillegg', formatCurrency(totals.supplements, 2)],
    ['Estimert brutto før skatt', formatCurrency(totals.gross, 2)],
    ['Estimerte feriepenger', formatCurrency(totals.holidayPay, 2)]
  ];
  return (
    <article className="rounded-xl bg-[#2c2c2e] p-4">
      <h3 className="break-words font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-gray-400">{totals.count} {totals.count === 1 ? 'vakt' : 'vakter'}</p>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-gray-300">{label}</dt>
            <dd className="shrink-0 text-right font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

// --- VAKTSKJEMA ---
function ShiftForm({ data, shift, date, onSave, onCancel, onOpenJobs }: {
  data: AppData;
  shift?: Shift;
  date?: string;
  onSave: (draft: Omit<Shift, 'id'>, id?: string) => boolean;
  onCancel: () => void;
  onOpenJobs: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState('');
  const availableJobs = data.jobs.filter(job => !job.deleted || job.id === shift?.jobId);
  const [draft, setDraft] = useState(() => {
    let lastUsed: LastShiftDefaults = {};
    try {
      lastUsed = JSON.parse(localStorage.getItem('lastShiftDefaults') || '{}') ?? {};
    } catch {
      // The form can start with its built-in defaults.
    }
    const job = availableJobs.find(item => item.id === (shift?.jobId ?? lastUsed.jobId)) ?? availableJobs[0];
    const initialDate = shift?.dato ?? date ?? today();
    const rate = shift ? hourlyRateForShift(shift, data.jobs.find(item => item.id === shift.jobId)) : job?.lonn;
    return {
      jobId: shift?.jobId ?? job?.id ?? '',
      dato: initialDate,
      start: shift?.start ?? lastUsed.start ?? '09:00',
      slutt: shift?.slutt ?? lastUsed.slutt ?? '17:00',
      pauseMin: Math.max(0, Number(shift ? shift.pauseMin : lastUsed.pauseMin) || 0),
      tilleggNok: Math.max(0, Number(shift ? shift.tilleggNok : lastUsed.tilleggNok) || 0),
      status: shift?.status ?? (initialDate > today() ? 'Kommende' : 'Fullfort'),
      timelonn: rate === undefined ? '' : String(rate)
    };
  });

  useEffect(() => {
    window.scrollTo(0, 0);
    headingRef.current?.focus();
  }, []);

  const overnight = crossesMidnight(draft);
  const overlaps = findOverlappingShifts(draft, data.shifts, shift?.id);
  const overlapKey = JSON.stringify([
    draft.dato, draft.start, draft.slutt,
    overlaps.map(({ id, dato, start, slutt }) => [id, dato, start, slutt])
  ]);

  const previousShift = !shift
    ? data.shifts
        .filter(item => item.status === 'Fullfort' && availableJobs.some(job => job.id === item.jobId))
        .sort((a, b) => b.dato.localeCompare(a.dato) || b.start.localeCompare(a.start))[0]
    : undefined;

  const copyPreviousShift = () => {
    if (!previousShift) return;
    const job = availableJobs.find(item => item.id === previousShift.jobId);
    setDraft(current => ({
      ...current,
      jobId: previousShift.jobId,
      start: previousShift.start,
      slutt: previousShift.slutt,
      pauseMin: previousShift.pauseMin ?? 0,
      tilleggNok: previousShift.tilleggNok ?? 0,
      timelonn: job ? String(job.lonn) : ''
    }));
    setError('');
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rate = Number(draft.timelonn);
    if (!draft.jobId) return setError('Velg en jobb.');
    if (draft.timelonn === '' || !isHourlyRate(rate)) return setError('Skriv inn en gyldig timelønn.');
    if (draft.pauseMin > shiftDurationMinutes(draft.start, draft.slutt)) {
      return setError('Pausen kan ikke være lengre enn vakten.');
    }
    if (draft.status === 'Fullfort' && draft.dato > today()) {
      return setError('Velg «Planlagt» for en vakt i fremtiden.');
    }
    if (draft.status === 'Kommende' && draft.dato < today()) {
      return setError('Velg «Jobbet» for en vakt som har vært.');
    }

    if (!onSave({ ...draft, timelonn: rate }, shift?.id)) {
      return setError('Vakten kunne ikke lagres på denne enheten. Prøv igjen.');
    }
    try {
      const { jobId, start, slutt, pauseMin, tilleggNok } = draft;
      localStorage.setItem('lastShiftDefaults', JSON.stringify({ jobId, start, slutt, pauseMin, tilleggNok }));
    } catch {
      // Remembering the last values is optional.
    }
  };

  const field = 'min-w-0 w-full rounded-xl bg-[#2c2c2e] px-3 py-3 text-base text-white [color-scheme:dark]';
  const label = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-gray-300';
  const selectedJob = availableJobs.find(job => job.id === draft.jobId);
  const hasEstimate = draft.start && draft.slutt && draft.timelonn !== '' && isHourlyRate(Number(draft.timelonn));

  return (
    <section className="rounded-3xl border border-[#2c2c2e] bg-[#1c1c1e] p-4 sm:p-6" aria-labelledby="shift-form-heading">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 id="shift-form-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          {shift ? 'Rediger vakt' : 'Logg vakt'}
        </h1>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-blue-300">Avbryt</button>
      </header>
      {availableJobs.length === 0 && !shift ? (
        <div className="space-y-3 rounded-xl bg-orange-900/30 p-4 text-sm text-orange-300">
          <p>Legg til en jobb før du logger en vakt.</p>
          <button type="button" onClick={onOpenJobs} className="min-h-11 font-semibold underline">Gå til innstillinger</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {previousShift && (
            <button type="button" onClick={copyPreviousShift} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2c2c2e] px-3 py-2 text-sm font-semibold text-blue-300">
              <Copy size={16} /> Kopier forrige vakt
            </button>
          )}
          <label className={label}>
            Jobb
            <select value={draft.jobId} onChange={event => {
              const jobId = event.target.value;
              const job = availableJobs.find(item => item.id === jobId);
              setDraft(current => ({ ...current, jobId, timelonn: job ? String(job.lonn) : '' }));
            }} className={field} required>
              {!selectedJob && <option value={draft.jobId}>Ukjent jobb</option>}
              {availableJobs.map(job => <option key={job.id} value={job.id}>{job.navn}{job.deleted ? ' (arkivert)' : ''}</option>)}
            </select>
          </label>
          <label className={label}>
            Dato
            <input type="date" value={draft.dato} onChange={event => setDraft({ ...draft, dato: event.target.value })} required className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Start<input type="time" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} required className={field} /></label>
            <label className={label}>Slutt<input type="time" value={draft.slutt} onChange={event => setDraft({ ...draft, slutt: event.target.value })} aria-describedby={overnight ? 'overnight-note' : undefined} required className={field} /></label>
          </div>
          <div aria-live="polite" className={!overnight && overlaps.length === 0 ? 'sr-only' : undefined}>
            {overnight && <p id="overnight-note" className="rounded-xl bg-blue-950/40 p-3 text-sm text-blue-200">Vakten slutter neste dag.</p>}
            {overlaps.length > 0 && (
              <div className={`rounded-xl border border-orange-500/20 bg-orange-900/30 p-3 text-sm text-orange-200 ${overnight ? 'mt-3' : ''}`}>
                <p id="overlap-note" className="font-semibold">Tidspunktet overlapper med {overlaps.length === 1 ? 'en annen vakt' : overlaps.length + ' andre vakter'}.</p>
                <ul className="mt-2 space-y-1">
                  {overlaps.map(item => (
                    <li key={item.id}>
                      {data.jobs.find(job => job.id === item.jobId)?.navn ?? 'Ukjent jobb'} · {item.dato.split('-').reverse().join('.')} · {item.start}–{item.slutt}{crossesMidnight(item) && ' (+1 dag)'}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                  <input key={overlapKey} type="checkbox" required aria-describedby="overlap-note" className="h-5 w-5 shrink-0 accent-orange-500" />
                  Jeg vil lagre vakten likevel
                </label>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Pause (min)<input type="number" min="0" step="1" inputMode="numeric" value={draft.pauseMin} onChange={event => setDraft({ ...draft, pauseMin: Number(event.target.value) })} className={field} /></label>
            <label className={label}>Tillegg (kr)<input type="number" min="0" step="0.01" inputMode="decimal" value={draft.tilleggNok} onChange={event => setDraft({ ...draft, tilleggNok: Number(event.target.value) })} className={field} /></label>
          </div>
          <label className={label}>
            Timelønn for vakten (kr)
            <input type="number" min="0" step="0.01" inputMode="decimal" value={draft.timelonn} onChange={event => setDraft({ ...draft, timelonn: event.target.value })} required className={field} />
          </label>
          {hasEstimate && (
            <p className="rounded-xl bg-blue-950/40 p-3 text-sm font-semibold text-blue-100">
              Estimert lønn før skatt: {formatCurrency(estimateShiftPay({ ...draft, timelonn: Number(draft.timelonn) }))}
            </p>
          )}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-300">Status</legend>
            <div className="flex gap-2">
              {(['Fullfort', 'Kommende'] as const).map(status => (
                <button key={status} type="button" aria-pressed={draft.status === status} onClick={() => setDraft({ ...draft, status })} className="min-h-11 flex-1 rounded-xl bg-[#2c2c2e] px-3 text-sm font-semibold text-gray-300 aria-pressed:bg-blue-950 aria-pressed:text-blue-100">
                  {status === 'Fullfort' ? 'Jobbet' : 'Planlagt'}
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-red-900/30 p-3 text-sm text-red-300">{error}</p>}
          <button type="submit" className="min-h-12 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-500">
            {shift ? 'Lagre endringer' : 'Lagre vakt'}
          </button>
        </form>
      )}
    </section>
  );
}

// --- VAKTLOGG ---
function VakterTab({ data, onUpdate, onOpenEditor, initialDate, onInitialDateApplied }: {
  data: AppData;
  onUpdate: (data: AppData) => void;
  onOpenEditor: (shift?: Shift, date?: string) => void;
  initialDate?: string;
  onInitialDateApplied: () => void;
}) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterTerm, setFilterTerm] = useState('');
  const [filterJob, setFilterJob] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterDate, setFilterDate] = useState(initialDate || 'all');

  useEffect(() => {
    if (initialDate) onInitialDateApplied();
  }, [initialDate, onInitialDateApplied]);

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
      ['Dato', 'Jobb', 'Status', 'Start', 'Slutt', 'Ubetalt pause (min)', 'Timer jobbet', 'Timelønn', 'Lønn (estimat)', 'Feriepenger (estimat)'],
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
          hourlyRateForShift(shift, job)?.toFixed(2) ?? '',
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
      
      <button type="button" onClick={() => onOpenEditor(undefined, filterDate === 'all' ? undefined : filterDate)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-500">
        <Plus size={20} /> Logg vakt
      </button>
      {errorMsg && <p role="alert" className="rounded-xl bg-red-900/30 p-3 text-sm text-red-300">{errorMsg}</p>}

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
            const rate = hourlyRateForShift(s, job);
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
                  {rate !== undefined && <p className="mt-1 text-xs text-gray-400">Timelønn: {rate.toLocaleString('nb-NO')} kr/t</p>}
                  {Number(s.tilleggNok) > 0 && <p className="mt-1 text-right text-xs text-gray-400">Inkl. {formatCurrency(Number(s.tilleggNok))} tillegg</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {s.status === 'Kommende' && (
                    <button onClick={() => handleComplete(s.id)} className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-green-900/30 text-green-300 hover:bg-green-900/50 rounded-xl text-sm font-bold transition-colors">
                      <CheckCircle2 size={16} strokeWidth={2.5} /> Ferdig
                    </button>
                  )}
                  <button onClick={() => onOpenEditor(s)} className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-[#2c2c2e] text-blue-300 hover:bg-[#38383a] rounded-xl text-sm font-bold transition-colors">
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
  onUpdate: (d: AppData) => boolean;
  installPromptAvailable: boolean;
  isInstalled: boolean;
  onInstall: () => void;
}) {
  const [newJob, setNewJob] = useState({ navn: '', lonn: '', ferie: '10' });
  const [jobError, setJobError] = useState<string | null>(null);
  const [rateEdit, setRateEdit] = useState<{ jobId: string; value: string } | null>(null);

  const saveJobRate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rateEdit) return;
    const rate = Number(rateEdit.value);
    if (!isHourlyRate(rate) || rate <= 0) return;
    const snapshot = withShiftRates(data);
    if (onUpdate({
      ...snapshot,
      jobs: snapshot.jobs.map(job => job.id === rateEdit.jobId ? { ...job, lonn: rate } : job)
    })) setRateEdit(null);
  };
  const [importStatus, setImportStatus] = useState<{ type: 'success'|'error', msg: string } | null>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupPreview | null>(null);
  const [lastExport, setLastExport] = useState(loadLastExport);
  const [readingBackup, setReadingBackup] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const autoBackup = useMemo(loadRecoveryBackup, [data]);
  const activeJobs = data.jobs.filter(j => !j.deleted);

  useEffect(() => {
    if (pendingBackup) previewHeading.current?.focus();
  }, [pendingBackup]);

  const handleExport = () => {
    const exportedAt = new Date().toISOString();
    const backupData = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt,
      ...data
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vakter-sikkerhetskopi-' + today() + '.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setLastExport(exportedAt);
    try {
      localStorage.setItem(LAST_EXPORT_KEY, exportedAt);
    } catch {
      // The downloaded file remains available even if the date cannot be stored.
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setReadingBackup(true);
    setPendingBackup(null);
    setImportStatus(null);
    try {
      const parsed: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      const backupData = parseBackup(parsed);
      const savedAt = isRecord(parsed) ? backupTimestamp(parsed.exportedAt) : undefined;
      setPendingBackup({ data: backupData, name: file.name, savedAt });
    } catch (error) {
      const msg = error instanceof Error && !(error instanceof SyntaxError || error instanceof DOMException)
        ? error.message
        : 'Filen kunne ikke leses. Velg en JSON-fil eksportert fra Vakter.';
      setImportStatus({ type: 'error', msg });
    } finally {
      setReadingBackup(false);
    }
  };

  const restoreBackup = () => {
    if (!pendingBackup) return;
    if (!onUpdate(pendingBackup.data)) {
      setImportStatus({ type: 'error', msg: 'Gjenoppretting kunne ikke lagres på denne enheten.' });
      return;
    }
    setPendingBackup(null);
    setImportStatus({ type: 'success', msg: 'Sikkerhetskopien er gjenopprettet. Du kan finne dataene du hadde før, i den automatiske kopien.' });
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
    if (onUpdate({ ...data, jobs: [...data.jobs, job] })) setNewJob({ navn: '', lonn: '', ferie: '10' });
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
              <div key={j.id} className="rounded-2xl bg-[#2c2c2e] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold text-white">{j.navn}</h3>
                    <p className="mt-0.5 text-sm text-gray-400">{j.lonn} kr/t • {j.feriesats * 100}% feriepenger</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setRateEdit({ jobId: j.id, value: String(j.lonn) })} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-blue-300">
                      Endre timelønn
                    </button>
                    <button type="button" onClick={() => handleDeleteJob(j.id)} aria-label={'Arkiver ' + j.navn} className="min-h-11 min-w-11 rounded-xl p-3 text-red-300 hover:bg-[#38383a]">
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
                {rateEdit?.jobId === j.id && (
                  <form onSubmit={saveJobRate} className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
                    <label className="flex flex-col gap-2 text-sm text-gray-300">
                      Ny timelønn for {j.navn} (kr)
                      <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={rateEdit.value} onChange={event => setRateEdit({ jobId: j.id, value: event.target.value })} className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2.5 text-base text-white" />
                    </label>
                    <p className="text-xs text-gray-400">Den nye satsen foreslås på vakter du registrerer heretter.</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={() => setRateEdit(null)} className="min-h-11 rounded-xl px-3 text-sm text-blue-300">Avbryt</button>
                      <button type="submit" className="min-h-11 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white">Lagre timelønn</button>
                    </div>
                  </form>
                )}
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
              <input type="number" min="0.01" step="0.01" value={newJob.lonn} onChange={e => setNewJob({...newJob, lonn: e.target.value})} required placeholder="190" className="w-full bg-[#2c2c2e] border border-transparent rounded-2xl px-4 py-3.5 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
        <p className="mb-5 text-sm leading-relaxed text-gray-400">Skal du bytte telefon? Last ned kopien, ta med filen til den nye telefonen og åpne «Mer» → «Sikkerhetskopi» for å velge den.</p>
        
        {importStatus && (
          <div role={importStatus.type === 'error' ? 'alert' : 'status'} className={`p-4 rounded-xl text-sm font-medium mb-4 flex gap-2 items-center ${importStatus.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-500/20' : 'bg-red-900/30 text-red-400 border border-red-500/20'}`}>
            <AlertCircle size={18} className="shrink-0" />
            {importStatus.msg}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-300" aria-live="polite">
            {lastExport ? 'Siste eksport: ' + format(parseISO(lastExport), 'd. MMM yyyy HH:mm', { locale: nb }) : 'Ingen eksport registrert på denne enheten.'}
          </p>
          <button type="button" onClick={handleExport} className="w-full min-h-12 bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] active:scale-[0.98]">
            Last ned sikkerhetskopi
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={handleImport} className="hidden" />
          <button type="button" disabled={readingBackup} onClick={() => fileInput.current?.click()} className="w-full min-h-12 bg-[#2c2c2e] text-white font-bold py-4 rounded-2xl transition-colors hover:bg-[#38383a] disabled:opacity-50">
            {readingBackup ? 'Leser sikkerhetskopi …' : 'Velg sikkerhetskopi fra fil'}
          </button>
          {pendingBackup && (
            <section className="rounded-2xl border border-blue-500/30 bg-blue-950/30 p-4" aria-labelledby="backup-preview-heading">
              <h3 id="backup-preview-heading" ref={previewHeading} tabIndex={-1} className="font-semibold">Forhåndsvis sikkerhetskopi</h3>
              <p className="mt-2 break-all text-sm text-gray-300">{pendingBackup.name}</p>
              {pendingBackup.savedAt && <p className="mt-1 text-sm text-gray-400">Laget {format(parseISO(pendingBackup.savedAt), 'd. MMM yyyy HH:mm', { locale: nb })}</p>}
              <p className="mt-2 text-sm font-semibold">{pendingBackup.data.shifts.length} {pendingBackup.data.shifts.length === 1 ? 'vakt' : 'vakter'} · {pendingBackup.data.jobs.length} {pendingBackup.data.jobs.length === 1 ? 'jobb' : 'jobber'}</p>
              <p className="mt-2 text-sm text-gray-300">Gjenoppretting erstatter vakter, jobber og avkrysninger på denne enheten. Det du har lagret nå, beholdes i den automatiske kopien.</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => { setPendingBackup(null); setImportStatus(null); }} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-blue-300">Avbryt</button>
                <button type="button" onClick={restoreBackup} className="min-h-11 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white">Erstatt data og gjenopprett</button>
              </div>
            </section>
          )}
          {autoBackup && (
            <div className="rounded-2xl border border-[#2c2c2e] p-4">
              <p className="text-sm text-gray-300">En tidligere versjon lagres automatisk før du endrer vakter eller jobber.</p>
              {autoBackup.savedAt && <p className="mt-1 text-xs text-gray-400">Sist lagret: {format(parseISO(autoBackup.savedAt), 'd. MMM yyyy HH:mm', { locale: nb })}</p>}
              <button type="button" disabled={readingBackup} onClick={() => { setImportStatus(null); setPendingBackup(autoBackup); }} className="mt-3 min-h-11 w-full rounded-xl bg-[#2c2c2e] px-4 py-3 text-sm font-bold text-blue-300 disabled:opacity-50">Se forrige automatiske kopi</button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
