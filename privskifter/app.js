// Initielle data
const standardJobber = [
    { id: "1", navn: "Hovedjobb", lonn: 190.00, feriesats: 0.102 },
    { id: "2", navn: "Deltidsprosjekt", lonn: 250.00, feriesats: 0.12 }
];

let mineJobber = JSON.parse(localStorage.getItem('myJobs')) || standardJobber;
let mineVakter = JSON.parse(localStorage.getItem('myShifts')) || [];
let kalenderDato = new Date(); // Dato for å styre hvilken måned kalenderen viser

document.addEventListener("DOMContentLoaded", () => {
    oppdaterSkjermbilde();
    fyllJobbSelect();
    settStandardTider(); // Fyller inn dagens dato og 22:00-03:00 automatisk
});

// Fyller inn dagens dato og standard arbeidstid
function settStandardTider() {
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagLokal = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
    
    document.getElementById("vaktDato").value = iDagLokal;
    document.getElementById("vaktStart").value = "22:00";
    document.getElementById("vaktSlutt").value = "03:00";
}

function oppdaterSkjermbilde() {
    localStorage.setItem('myJobs', JSON.stringify(mineJobber));
    localStorage.setItem('myShifts', JSON.stringify(mineVakter));
    
    byggDashboard();
    byggVaktListe();
    byggHistorikkStatistikk();
    byggKalender();
    byggJobbListe();
}

function byttTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(`tab-${tabId}`).classList.remove("hidden");
    event.target.classList.add("active");
    if(tabId === 'kalender') byggKalender();
}

function beregnTimer(start, slutt) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = slutt.split(":").map(Number);
    let timer = (eh + em/60) - (sh + sm/60);
    return timer < 0 ? timer + 24 : timer; // Håndterer vakter over midnatt perfekt
}

function hentJobbInfo(jobId) {
    return mineJobber.find(j => j.id === jobId);
}

// ================= DASHBOARD & FRIDAGER =================
function byggDashboard() {
    const iDag = new Date();
    const sorterteVakter = [...mineVakter].sort((a,b) => new Date(a.dato) - new Date(b.dato));
    let nesteVakt = null;
    let totalFeriepenger = 0;

    sorterteVakter.forEach(v => {
        const jobb = hentJobbInfo(v.jobId);
        if (!jobb) return;

        const brutto = beregnTimer(v.start, v.slutt) * jobb.lonn;
        if (v.status === "Fullfort") totalFeriepenger += (brutto * jobb.feriesats);

        if (v.status === "Kommende" && new Date(v.dato) >= new Date(iDag.toISOString().split('T')[0])) {
            if (!nesteVakt) nesteVakt = { ...v, jobbNavn: jobb.navn };
        }
    });

    document.getElementById("headerFeriepenger").innerText = totalFeriepenger.toLocaleString('no-NO', {maximumFractionDigits:0}) + " kr";

    const nesteBoks = document.getElementById("nesteVaktKort");
    if (nesteVakt) {
        nesteBoks.innerHTML = `
            <h4>${nesteVakt.jobbNavn}</h4>
            <p><strong>Dato:</strong> ${formaterDato(nesteVakt.dato)}</p>
            <p><strong>Tid:</strong> ${nesteVakt.start} - ${nesteVakt.slutt} (${beregnTimer(nesteVakt.start, nesteVakt.slutt).toFixed(1)} timer)</p>
        `;
    } else {
        nesteBoks.innerHTML = "<p>Ingen kommende vakter planlagt.</p>";
    }
    finnFridager();
}

function finnFridager() {
    const boks = document.getElementById("fridagerListe");
    boks.innerHTML = "";
    const iDag = new Date(); iDag.setHours(0,0,0,0);
    let fridagerFunnet = 0;

    for (let i = 0; i < 14; i++) {
        const sjekkDato = new Date(iDag);
        sjekkDato.setDate(sjekkDato.getDate() + i);
        const datoStr = sjekkDato.toISOString().split('T')[0];

        if (!mineVakter.some(v => v.dato === datoStr)) {
            const ukedag = sjekkDato.toLocaleDateString('no-NO', { weekday: 'long' });
            const pDato = sjekkDato.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
            boks.innerHTML += `<div class="fri-tag">🏖️ ${ukedag.charAt(0).toUpperCase() + ukedag.slice(1)} ${pDato}</div>`;
            fridagerFunnet++;
        }
    }
    if (fridagerFunnet === 0) boks.innerHTML = "<p class='text-muted'>Ingen helt ledige dager de neste 14 dagene.</p>";
}

// ================= HISTORIKK & TOTAL ØKONOMI =================
function byggHistorikkStatistikk() {
    const iDag = new Date();
    const innevaerendeMnd = iDag.toISOString().substring(0, 7);
    const innevaerendeAar = iDag.getFullYear().toString();

    let totalTimer = 0;
    let totalLonn = 0;
    let mndLonn = 0;
    let aarLonn = 0;

    const dataPerMnd = {};

    mineVakter.forEach(v => {
        if (v.status !== "Fullfort") return; 
        const jobb = hentJobbInfo(v.jobId);
        if (!jobb) return;

        const mnd = v.dato.substring(0, 7);
        const aar = v.dato.substring(0, 4);
        const timer = beregnTimer(v.start, v.slutt);
        const brutto = timer * jobb.lonn;
        const ferie = brutto * jobb.feriesats;

        totalTimer += timer;
        totalLonn += brutto;
        if (mnd === innevaerendeMnd) mndLonn += brutto;
        if (aar === innevaerendeAar) aarLonn += brutto;

        const nokkel = `${mnd}_${jobb.navn}`;
        if (!dataPerMnd[nokkel]) dataPerMnd[nokkel] = { maaned: mnd, jobbNavn: jobb.navn, timer: 0, brutto: 0, feriepenger: 0 };
        dataPerMnd[nokkel].timer += timer;
        dataPerMnd[nokkel].brutto += brutto;
        dataPerMnd[nokkel].feriepenger += ferie;
    });

    const snittLonn = totalTimer > 0 ? (totalLonn / totalTimer) : 0;
    document.getElementById("statSnittLonn").innerText = snittLonn.toFixed(1) + " kr/t";
    document.getElementById("statMndLonn").innerText = mndLonn.toLocaleString('no-NO', {maximumFractionDigits:0}) + " kr";
    document.getElementById("statAarLonn").innerText = aarLonn.toLocaleString('no-NO', {maximumFractionDigits:0}) + " kr";
    document.getElementById("statTotalLonn").innerText = totalLonn.toLocaleString('no-NO', {maximumFractionDigits:0}) + " kr";

    const historikkArray = Object.values(dataPerMnd).sort((a,b) => b.maaned.localeCompare(a.maaned));
    const tbody = document.getElementById("historikkTabell");
    tbody.innerHTML = "";

    historikkArray.forEach(rad => {
        tbody.innerHTML += `
            <tr>
                <td><strong>${rad.maaned}</strong></td>
                <td>${rad.jobbNavn}</td>
                <td>${rad.timer.toFixed(1)} t</td>
                <td>${rad.brutto.toLocaleString('no-NO', {maximumFractionDigits:0})} kr</td>
                <td class="text-success">+ ${rad.feriepenger.toLocaleString('no-NO', {maximumFractionDigits:0})} kr</td>
            </tr>
        `;
    });
}

// ================= KALENDER =================
function endreMaaned(offset) {
    kalenderDato.setMonth(kalenderDato.getMonth() + offset);
    byggKalender();
}

function byggKalender() {
    const boks = document.getElementById("kalenderDager");
    boks.innerHTML = "";

    const aar = kalenderDato.getFullYear();
    const mnd = kalenderDato.getMonth();
    
    const manedsNavn = kalenderDato.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    document.getElementById("kalenderTittel").innerText = manedsNavn.charAt(0).toUpperCase() + manedsNavn.slice(1);

    let forsteDag = new Date(aar, mnd, 1).getDay() - 1;
    if (forsteDag === -1) forsteDag = 6;
    
    const dagerIMnd = new Date(aar, mnd + 1, 0).getDate();
    const dagensDatoStr = new Date().toISOString().split('T')[0];

    for (let i = 0; i < forsteDag; i++) {
        boks.innerHTML += `<div class="calendar-cell empty"></div>`;
    }

    for (let dag = 1; dag <= dagerIMnd; dag++) {
        const sjekkDate = new Date(aar, mnd, dag);
        const offset = sjekkDate.getTimezoneOffset() * 60000;
        const lokalIso = new Date(sjekkDate.getTime() - offset).toISOString().split('T')[0];

        let isToday = lokalIso === dagensDatoStr ? "today" : "";
        let vaktHtml = "";

        const dagensVakter = mineVakter.filter(v => v.dato === lokalIso);
        dagensVakter.forEach(v => {
            const jobb = hentJobbInfo(v.jobId);
            if(jobb) {
                const antT = beregnTimer(v.start, v.slutt).toFixed(1);
                const statusKlasse = v.status === "Fullfort" ? "fullfort" : "";
                vaktHtml += `
                    <div class="cal-shift ${statusKlasse}">
                        <span class="cal-job-name">${jobb.navn}</span>
                        <span>${v.start}-${v.slutt} (${antT}t)</span>
                    </div>
                `;
            }
        });

        boks.innerHTML += `
            <div class="calendar-cell ${isToday}">
                <div class="calendar-date">${dag}</div>
                ${vaktHtml}
            </div>
        `;
    }
}

// ================= VAKTER (LOGGING) & JOBBER =================
function lagreVakt(e) {
    e.preventDefault();
    
    const valgtDato = document.getElementById("vaktDato").value;
    const valgtStatus = document.getElementById("vaktStatus").value;
    
    // Hent dagens dato i lokal tidssone (YYYY-MM-DD)
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

    // 🛑 SIKKERHETSREGEL 1: Ikke lov å logge fullført jobb i fremtiden
    if (valgtStatus === "Fullfort" && valgtDato > iDagStr) {
        alert("⚠️ Feil: Du kan ikke logge en jobb som 'Fullført' hvis datoen er frem i tid!");
        return;
    }

    // 🛑 SIKKERHETSREGEL 2: Ikke lov å ha en kommende jobb i fortiden
    if (valgtStatus === "Kommende" && valgtDato < iDagStr) {
        alert("⚠️ Feil: Datoen er i fortiden. Du kan ikke sette denne vakten som 'Kommende'. Endre statusen til 'Fullført' eller juster datoen.");
        return;
    }

    mineVakter.push({
        id: Date.now(),
        jobId: document.getElementById("vaktJobb").value,
        dato: valgtDato,
        start: document.getElementById("vaktStart").value,
        slutt: document.getElementById("vaktSlutt").value,
        status: valgtStatus
    });
    
    oppdaterSkjermbilde();
    settStandardTider();
}

function byggVaktListe() {
    const tbody = document.getElementById("vaktListeTabell");
    tbody.innerHTML = "";
    const sorterte = [...mineVakter].sort((a,b) => new Date(b.dato) - new Date(a.dato));

    sorterte.forEach(v => {
        const jobb = hentJobbInfo(v.jobId);
        if(!jobb) return;
        const badge = v.status === "Kommende" ? `<span class="badge badge-kommende">Kommende</span>` : `<span class="badge badge-fullfort">Fullført</span>`;
        const action = v.status === "Kommende" ? `<button class="btn-switch" onclick="markerSomFullfort(${v.id})">✔ Ferdig</button>` : ``;

        tbody.innerHTML += `
            <tr>
                <td>${formaterDato(v.dato)}</td>
                <td><strong>${jobb.navn}</strong></td>
                <td>${v.start} - ${v.slutt}</td>
                <td>${badge}</td>
                <td style="display:flex; gap:5px;">
                    ${action}
                    <button class="btn-small" onclick="slettVakt(${v.id})">Slett</button>
                </td>
            </tr>
        `;
    });
}

function markerSomFullfort(id) { 
    const vakt = mineVakter.find(v => v.id === id);
    if (!vakt) return;

    // Hent dagens dato i lokal tidssone
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const iDagStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

    // 🛑 SIKKERHETSREGEL 3: Kan ikke trykke fullført på vakter i fremtiden
    if (vakt.dato > iDagStr) {
        alert("⚠️ Vent litt! Du kan ikke godkjenne denne vakten ennå fordi datoen er i fremtiden.");
        return;
    }

    vakt.status = "Fullfort"; 
    oppdaterSkjermbilde(); 
}

function slettVakt(id) { mineVakter = mineVakter.filter(v => v.id !== id); oppdaterSkjermbilde(); }

function fyllJobbSelect() {
    const sel = document.getElementById("vaktJobb");
    sel.innerHTML = "";
    mineJobber.forEach(j => { sel.innerHTML += `<option value="${j.id}">${j.navn}</option>`; });
}

function byggJobbListe() {
    const boks = document.getElementById("jobbListe");
    boks.innerHTML = "";
    mineJobber.forEach(j => {
        boks.innerHTML += `
            <div class="jobb-item">
                <div><h3 style="margin:0">${j.navn}</h3><p class="text-muted" style="margin:0">Timelønn: ${j.lonn} kr</p></div>
                <button class="btn-small" onclick="slettJobb('${j.id}')">Fjern</button>
            </div>
        `;
    });
    fyllJobbSelect();
}

function leggTilJobb(e) {
    e.preventDefault();
    mineJobber.push({
        id: Date.now().toString(),
        navn: document.getElementById("nyJobbNavn").value,
        lonn: parseFloat(document.getElementById("nyJobbLonn").value),
        feriesats: parseFloat(document.getElementById("nyJobbFerie").value) / 100
    });
    document.getElementById("jobbSkjema").reset();
    oppdaterSkjermbilde();
}

function slettJobb(id) {
    if(confirm("Er du sikker?")) { mineJobber = mineJobber.filter(j => j.id !== id); oppdaterSkjermbilde(); }
}

function formaterDato(dStr) {
    return new Date(dStr).toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
}



// --- EKSPORT: Lagre data til iPhone ---
document.getElementById('eksport-knapp').addEventListener('click', function() {
    // Hent all data fra LocalStorage
    const data = JSON.stringify(localStorage);
    
    // Lag en fil av dataen
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Lag en usynlig lenke som laster ned filen automatisk
    const a = document.createElement('a');
    a.href = url;
    a.download = 'min_kalkulator_backup.json'; // Navnet på filen du får
    a.click();
    
    // Rydd opp
    URL.revokeObjectURL(url);
});

// --- IMPORT: Hent data fra iPhone ---
const importKnapp = document.getElementById('import-knapp');
const filVelger = document.getElementById('fil-velger');

// Åpne filvelgeren når vi trykker på import-knappen
importKnapp.addEventListener('click', function() {
    filVelger.click();
});

// Når du har valgt filen i "Filer"-appen
filVelger.addEventListener('change', function(event) {
    const fil = event.target.files[0];
    if (!fil) return;

    const leser = new FileReader();
    leser.onload = function(e) {
        const data = JSON.parse(e.target.result);
        
        // Tøm gammel data og legg inn den nye fra filen
        localStorage.clear();
        for (let nøkkel in data) {
            localStorage.setItem(nøkkel, data[nøkkel]);
        }
        
        alert("Backup lastet inn! Siden lastes inn på nytt for å vise dataene.");
        location.reload(); // Oppdaterer siden slik at kalkulatoren din viser tallene
    };
    leser.readAsText(fil);
});